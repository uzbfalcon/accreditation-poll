from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.db import connections, transaction
from django.db import models
from django.db.models import Count
from django.utils.html import format_html, format_html_join
from django.utils import timezone
from django.utils.safestring import mark_safe

from .scoring import ANSWER_WEIGHTS, recalculate_session
from .models import AuditSession, Criterion, Organization, OrganizationServices, SessionAnswer, SitePage, Standard

admin.site.site_header = 'CLAMO Akkreditatsiya — Administrator'
admin.site.site_title = 'CLAMO Admin'
admin.site.index_title = 'Boshqaruv paneli'

ANSWER_STYLES = {
    'YES': ('Bor', '#047857', '#ecfdf5'),
    'PARTIAL': ('Qisman', '#b45309', '#fffbeb'),
    'NO': ("Yo'q", '#be123c', '#fff1f2'),
    'NA': ('Tegishli emas', '#475569', '#f1f5f9'),
}

READINESS_STYLES = {
    'READY': ('#047857', '#ecfdf5'),
    'PARTIALLY_READY': ('#b45309', '#fffbeb'),
    'NOT_READY': ('#be123c', '#fff1f2'),
}


# Bazada qisqa matnlar ham TEXT turida — admin'da textarea emas, bir qatorli maydon ko'rsatiladi
SINGLE_LINE_TEXT = {models.TextField: {'widget': forms.TextInput(attrs={'class': 'vTextField'})}}


def badge(text, color, bg):
    return format_html(
        '<span style="color:{};background:{};padding:2px 8px;border-radius:10px;font-weight:600;white-space:nowrap">{}</span>',
        color, bg, text,
    )


# ---------------------------------------------------------------------------
# Tashkilotlar
# ---------------------------------------------------------------------------

class OrganizationServicesInline(admin.StackedInline):
    model = OrganizationServices
    can_delete = False
    max_num = 1
    verbose_name_plural = "Amaldagi xizmatlar («Tegishli emas» qoidalari)"


class AuditSessionInline(admin.TabularInline):
    model = AuditSession
    fields = ('id', 'status', 'total_score', 'readiness_category', 'submitted_at', 'updated_at')
    readonly_fields = fields
    extra = 0
    can_delete = False
    show_change_link = True
    verbose_name_plural = 'Audit sessiyalari'

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    formfield_overrides = SINGLE_LINE_TEXT
    list_display = ('name', 'inn', 'region', 'district', 'level', 'profile', 'sessions_count', 'created_at')
    list_filter = ('region', 'level', 'profile')
    search_fields = ('inn', 'name', 'cadastre_number', 'address')
    readonly_fields = ('id', 'inn', 'created_at')
    fieldsets = (
        (None, {'fields': ('id', 'inn', 'name', 'cadastre_number')}),
        ('Joylashuv', {'fields': ('region', 'district', 'address')}),
        ('Tavsif', {'fields': ('level', 'profile', 'bed_capacity', 'daily_visits', 'departments_count', 'created_at')}),
    )
    inlines = (OrganizationServicesInline, AuditSessionInline)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_sessions_count=Count('sessions'))

    @admin.display(description='Sessiyalar', ordering='_sessions_count')
    def sessions_count(self, obj):
        return obj._sessions_count

    # Tashkilotlar klinika portalida INN orqali yaratiladi
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ---------------------------------------------------------------------------
# Audit sessiyalari
# ---------------------------------------------------------------------------

class AuditSessionForm(forms.ModelForm):
    class Meta:
        model = AuditSession
        fields = '__all__'

    def clean_status(self):
        status = self.cleaned_data['status']
        if status == 'SUBMITTED' and self.instance.pk:
            # Bitta tashkilot (INN) — bitta topshirilgan ariza
            other = (
                AuditSession.objects.filter(org_id=self.instance.org_id, status='SUBMITTED')
                .exclude(pk=self.instance.pk)
                .first()
            )
            if other:
                raise ValidationError(
                    f"Bu tashkilotning boshqa topshirilgan arizasi bor ({other.pk}). "
                    "Bitta INN arizani faqat bir marta topshirishi mumkin."
                )
        return status


@admin.register(AuditSession)
class AuditSessionAdmin(admin.ModelAdmin):
    form = AuditSessionForm
    formfield_overrides = SINGLE_LINE_TEXT
    list_display = (
        'id', 'org_name', 'org_region', 'submitter_fio', 'status_badge', 'score_display',
        'readiness_badge', 'has_critical_stop_factors', 'final_stage_at', 'submitted_at', 'updated_at',
    )
    list_display_links = ('id', 'org_name')
    list_filter = ('status', 'readiness_category', 'has_critical_stop_factors', 'org__region', 'org__level')
    search_fields = ('id', 'org__inn', 'org__name', 'submitter_fio', 'submitter_phone')
    list_select_related = ('org',)
    list_per_page = 50
    actions = ('unlock_final_stage', 'reopen_as_draft')

    # Natija javoblardan hisoblanadi (Next.js har o'qishda qayta hisoblaydi) — to'g'ridan-to'g'ri tahrirlanmaydi;
    # o'zgartirish uchun «Javoblar» tabidagi javoblar tahrirlanadi va saqlashda Natija qayta hisoblanadi.
    readonly_fields = (
        'id', 'org', 'total_score', 'readiness_category', 'has_critical_stop_factors',
        'total_applicable', 'criteria_yes', 'criteria_partial', 'criteria_no', 'criteria_na',
        'final_stage_at', 'submitted_at', 'updated_at', 'answers_table',
    )
    fieldsets = (
        (None, {'fields': ('id', 'org', 'status', 'submitter_fio', 'submitter_phone')}),
        ('Natija', {
            'description': "Javoblardan avtomatik hisoblanadi. O'zgartirish uchun «Javoblar» tabida javoblarni "
                           "tahrirlab saqlang — ball, tayyorgarlik va stop-faktor darhol qayta hisoblanadi.",
            'fields': (
                'total_score', 'readiness_category', 'has_critical_stop_factors', 'total_applicable',
                ('criteria_yes', 'criteria_partial', 'criteria_no', 'criteria_na'),
            ),
        }),
        ('Vaqtlar', {'fields': ('final_stage_at', 'submitted_at', 'updated_at')}),
        ("Javoblar (bo'limlar bo'yicha)", {'fields': ('answers_table',)}),
    )

    @admin.display(description='Tashkilot', ordering='org__name')
    def org_name(self, obj):
        return obj.org.name

    @admin.display(description='Viloyat', ordering='org__region')
    def org_region(self, obj):
        return obj.org.region

    @admin.display(description='Holati', ordering='status')
    def status_badge(self, obj):
        if obj.status == 'SUBMITTED':
            return badge('Topshirilgan', '#1d4ed8', '#eff6ff')
        return badge('Qoralama', '#475569', '#f1f5f9')

    @admin.display(description='Ball', ordering='total_score')
    def score_display(self, obj):
        return f'{obj.total_score:.1f}%'

    @admin.display(description='Tayyorgarlik', ordering='readiness_category')
    def readiness_badge(self, obj):
        color, bg = READINESS_STYLES.get(obj.readiness_category, ('#475569', '#f1f5f9'))
        return badge(obj.get_readiness_category_display(), color, bg)

    @admin.display(description='Javoblar')
    def answers_table(self, obj):
        answers = {a.criterion_id: a for a in SessionAnswer.objects.filter(session_id=obj.id)}
        criteria = Criterion.objects.select_related('standard').order_by(
            'standard__domain_id', 'standard_id', 'criterion_number'
        )
        options = [('', '— javob yo\'q —')] + [(value, label) for value, (label, _, _) in ANSWER_STYLES.items()]
        rows = []
        current_domain = None
        for c in criteria:
            st = c.standard
            if st.domain_id != current_domain:
                current_domain = st.domain_id
                rows.append(format_html(
                    '<tr><th colspan="4" style="background:#0f766e;color:#fff;padding:6px 8px">{}-bo&#x27;lim. {}</th></tr>',
                    st.domain_id, st.domain_name,
                ))
            a = answers.get(c.id)
            current = a.answer_value if a else ''
            _, color, bg = ANSWER_STYLES.get(current, ('', '#475569', '#ffffff'))
            select = format_html(
                '<select name="answer_{}" aria-label="Mezon {}.{} javobi" '
                'style="min-width:150px;padding:3px 6px;border-radius:6px;border:1px solid {};background:{};color:{};font-weight:600">{}</select>',
                c.id, st.id, c.criterion_number, color, bg, color,
                format_html_join('', '<option value="{}"{}>{}</option>', (
                    (value, mark_safe(' selected') if value == current else '', label) for value, label in options
                )),
            )
            rows.append(format_html(
                '<tr><td style="white-space:nowrap">{}.{}</td><td>{}{}</td><td>{}</td><td>{}</td></tr>',
                st.id, c.criterion_number, c.description,
                mark_safe(' <strong style="color:#be123c">(kritik)</strong>') if c.is_critical else '',
                select, (a.note if a and a.note else ''),
            ))
        return format_html(
            '<table style="width:100%"><thead><tr><th>Mezon</th><th>Tavsif</th><th>Javob</th><th>Izoh</th></tr></thead>'
            '<tbody>{}</tbody></table>',
            format_html_join('', '{}', ((r,) for r in rows)),
        )

    def save_model(self, request, obj, form, change):
        now = timezone.now().strftime('%Y-%m-%d %H:%M:%S')  # UTC — Next.js bilan bir xil format
        if 'status' in form.changed_data:
            if obj.status == 'SUBMITTED' and not obj.submitted_at:
                obj.submitted_at = now
            elif obj.status == 'DRAFT':
                obj.submitted_at = None
                obj.final_stage_at = None
        super().save_model(request, obj, form, change)

        if change:
            obj._answer_changes = self._apply_answer_changes(request, obj, now)

    def _apply_answer_changes(self, request, obj, now):
        """Formadagi «answer_<mezon_id>» qiymatlarini bazaga yozadi va o'zgarishlar ro'yxatini qaytaradi."""
        submitted = {}
        for key, value in request.POST.items():
            if key.startswith('answer_') and key[7:].isdigit():
                if value and value not in ANSWER_WEIGHTS:
                    continue  # noma'lum qiymat — e'tiborsiz
                submitted[int(key[7:])] = value

        if not submitted:
            return []
        criteria = {c.id: c for c in Criterion.objects.filter(id__in=submitted.keys())}
        existing = dict(SessionAnswer.objects.filter(session_id=obj.pk).values_list('criterion_id', 'answer_value'))

        changes = []
        with transaction.atomic(using='clamo'), connections['clamo'].cursor() as cursor:
            for criterion_id, value in submitted.items():
                old = existing.get(criterion_id, '')
                if criterion_id not in criteria or value == old:
                    continue
                if value:
                    cursor.execute(
                        '''
                        INSERT INTO session_answers (session_id, criterion_id, answer_value, score_weight, note, updated_at)
                        VALUES (%s, %s, %s, %s, '', %s)
                        ON CONFLICT(session_id, criterion_id) DO UPDATE SET
                            answer_value = excluded.answer_value, score_weight = excluded.score_weight,
                            updated_at = excluded.updated_at
                        ''',
                        [obj.pk, criterion_id, value, ANSWER_WEIGHTS[value], now],
                    )
                else:
                    cursor.execute(
                        'DELETE FROM session_answers WHERE session_id = %s AND criterion_id = %s', [obj.pk, criterion_id]
                    )
                c = criteria[criterion_id]
                label = lambda v: ANSWER_STYLES[v][0] if v else '—'
                changes.append(f'{c.standard_id}.{c.criterion_number}: {label(old)} → {label(value)}')
            if changes:
                recalculate_session(obj.pk)

        if changes:
            self.message_user(
                request, f"{len(changes)} ta javob o'zgartirildi, ball va tayyorgarlik qayta hisoblandi.", messages.SUCCESS
            )
        return changes

    def construct_change_message(self, request, form, formsets, add=False):
        message = super().construct_change_message(request, form, formsets, add)
        changes = getattr(form.instance, '_answer_changes', None)
        if changes:
            # History: «Changed 16.2: Bor → Yo'q, 38.1: … and …» (juda ko'p bo'lsa — birinchi 50 tasi)
            shown = changes[:50] + ([f'yana {len(changes) - 50} ta'] if len(changes) > 50 else [])
            message.append({'changed': {'fields': [f'javob {c}' for c in shown]}})
        return message

    @admin.action(description="Yakuniy bo'lim qulfini ochish (klinika 1–6-bo'limlarga qayta oladi)")
    def unlock_final_stage(self, request, queryset):
        drafts = queryset.filter(status='DRAFT')
        updated = drafts.update(final_stage_at=None)
        skipped = queryset.count() - drafts.count()
        self.message_user(request, f'{updated} ta sessiya qulfi ochildi.', messages.SUCCESS)
        if skipped:
            self.message_user(
                request, f"{skipped} ta topshirilgan sessiya o'tkazib yuborildi — avval qoralamaga qaytaring.",
                messages.WARNING,
            )

    @admin.action(description='Qoralamaga qaytarish (topshirilgan arizani qayta ochish)')
    def reopen_as_draft(self, request, queryset):
        updated = queryset.update(status='DRAFT', submitted_at=None, final_stage_at=None)
        self.message_user(request, f'{updated} ta sessiya qoralamaga qaytarildi.', messages.SUCCESS)

    # Sessiyalar klinika portalida yaratiladi; o'chirish javoblarni yetim qoldiradi
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ---------------------------------------------------------------------------
# Standartlar va mezonlar
# ---------------------------------------------------------------------------

class CriterionInline(admin.TabularInline):
    model = Criterion
    fields = ('criterion_number', 'description', 'is_gold', 'sop_required', 'is_critical')
    readonly_fields = ('criterion_number', 'is_gold', 'sop_required', 'is_critical')
    formfield_overrides = {models.TextField: {'widget': forms.Textarea(attrs={'rows': 2, 'style': 'width: 100%'})}}
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Standard)
class StandardAdmin(admin.ModelAdmin):
    list_display = ('id', 'domain_name', 'title', 'applicability_condition', 'is_gold', 'criteria_count')
    list_display_links = ('id', 'title')
    list_filter = ('domain_name', 'is_gold')
    search_fields = ('title', 'applicability_condition', 'criteria__description')
    ordering = ('domain_id', 'id')
    list_per_page = 100  # barcha 75 ta standart bitta sahifada
    readonly_fields = ('id', 'domain_id', 'domain_name', 'is_gold')
    fields = ('id', 'domain_id', 'domain_name', 'title', 'applicability_condition', 'is_gold')
    formfield_overrides = {models.TextField: {'widget': forms.Textarea(attrs={'rows': 3, 'style': 'width: 100%'})}}
    inlines = (CriterionInline,)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_criteria_count=Count('criteria', distinct=True))

    @admin.display(description='Mezonlar', ordering='_criteria_count')
    def criteria_count(self, obj):
        return obj._criteria_count

    # 75 ta standart tuzilmasi ball hisobi va «Tegishli emas» qoidalariga bog'langan — faqat matnni tahrirlash mumkin
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Criterion)
class CriterionAdmin(admin.ModelAdmin):
    list_display = ('code', 'domain', 'description', 'is_gold', 'sop_required', 'is_critical')
    list_filter = ('standard__domain_name', 'is_gold', 'sop_required', 'is_critical')
    search_fields = ('description', 'standard__title')
    list_select_related = ('standard',)
    ordering = ('standard__domain_id', 'standard_id', 'criterion_number')
    readonly_fields = ('standard', 'criterion_number', 'is_gold', 'sop_required', 'is_critical')
    fields = ('standard', 'criterion_number', 'description', 'is_gold', 'sop_required', 'is_critical')
    list_per_page = 100
    list_max_show_all = 300  # «Hammasini ko'rsatish» — barcha 275 ta mezon bitta sahifada

    @admin.display(description='Mezon', ordering='standard_id')
    def code(self, obj):
        return f'{obj.standard_id}.{obj.criterion_number}'

    @admin.display(description="Bo'lim", ordering='standard__domain_id')
    def domain(self, obj):
        return obj.standard.domain_name

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ---------------------------------------------------------------------------
# Statik sahifalar (oferta)
# ---------------------------------------------------------------------------

@admin.register(SitePage)
class SitePageAdmin(admin.ModelAdmin):
    list_display = ('title', 'slug', 'updated_at', 'site_link')
    readonly_fields = ('slug', 'updated_at', 'site_link')
    fields = ('slug', 'site_link', 'title', 'content', 'updated_at')
    formfield_overrides = {
        models.TextField: {'widget': forms.Textarea(attrs={
            'rows': 40, 'style': 'width: 100%; font-family: ui-monospace, Menlo, monospace; font-size: 13px',
        })},
    }

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        form.base_fields['title'].widget = forms.TextInput(attrs={'class': 'vTextField', 'style': 'width: 100%'})
        return form

    @admin.display(description='Saytda')
    def site_link(self, obj):
        url = f"{settings.CLAMO_SITE_URL.rstrip('/')}/{obj.slug}"
        return format_html('<a href="{}" target="_blank" rel="noopener">{}</a>', url, url)

    def save_model(self, request, obj, form, change):
        obj.updated_at = timezone.localtime().strftime('%Y-%m-%d %H:%M:%S')
        super().save_model(request, obj, form, change)

    # Sahifalar sayt kodiga bog'langan (masalan, /oferta) — faqat matnni tahrirlash mumkin
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
