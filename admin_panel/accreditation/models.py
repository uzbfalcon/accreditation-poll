"""
Next.js ilovasi bazasidagi (clamo_accreditation.db) mavjud jadvallar.
managed=False: Django bu jadvallarni yaratmaydi, o'zgartirmaydi va migratsiya qilmaydi.
Sana/vaqt ustunlari bazada TEXT ko'rinishida turli formatlarda saqlangani uchun CharField.
"""

from django.db import models

LEVEL_CHOICES = [
    ('RESPUBLIKA', 'Respublika'),
    ('VILOYAT', 'Viloyat'),
    ('TUMAN', 'Tuman'),
]

PROFILE_CHOICES = [
    ('AMBULATOR', 'Ambulator'),
    ('STATSIONAR', 'Statsionar'),
    ('ARALASH', 'Aralash'),
]

STATUS_CHOICES = [
    ('DRAFT', 'Qoralama'),
    ('SUBMITTED', 'Topshirilgan'),
]

READINESS_CHOICES = [
    ('READY', 'Akkreditatsiyaga tayyor'),
    ('PARTIALLY_READY', 'Qisman tayyor'),
    ('NOT_READY', 'Tayyor emas'),
]

ANSWER_CHOICES = [
    ('YES', 'Bor'),
    ('PARTIAL', 'Qisman'),
    ('NO', "Yo'q"),
    ('NA', 'Tegishli emas'),
]


class Organization(models.Model):
    id = models.TextField(primary_key=True)
    inn = models.TextField('INN', unique=True)
    name = models.TextField('Nomi')
    cadastre_number = models.TextField('Kadastr raqami', blank=True, null=True)
    region = models.TextField('Viloyat')
    district = models.TextField('Tuman')
    address = models.TextField('Manzil', blank=True, null=True)
    level = models.TextField('Darajasi', choices=LEVEL_CHOICES, default='VILOYAT')
    profile = models.TextField('Profili', choices=PROFILE_CHOICES, default='ARALASH')
    bed_capacity = models.IntegerField("O'rinlar soni", default=0)
    daily_visits = models.IntegerField('Kunlik tashriflar', default=0)
    departments_count = models.IntegerField("Bo'linmalar soni", default=0)
    created_at = models.CharField('Yaratilgan', max_length=32, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'organizations'
        verbose_name = 'Tashkilot'
        verbose_name_plural = 'Tashkilotlar'
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.inn})'


class OrganizationServices(models.Model):
    org = models.OneToOneField(
        Organization, on_delete=models.CASCADE, primary_key=True, db_column='org_id', related_name='services'
    )
    has_emergency_blue_code = models.BooleanField("Shoshilinch yordam / «Ko'k kod»", default=True)
    has_surgery = models.BooleanField('Jarrohlik', default=True)
    has_anesthesia = models.BooleanField('Anesteziya / sedatsiya', default=True)
    has_laboratory = models.BooleanField('Laboratoriya', default=True)
    has_radiology_ultrasound = models.BooleanField('Nur diagnostikasi / UTT', default=True)
    has_mri = models.BooleanField('MRT', default=False)
    has_endoscopy = models.BooleanField('Endoskopiya', default=True)
    has_sterilization_dept = models.BooleanField("Sterilizatsiya bo'linmasi", default=True)
    has_academic_base = models.BooleanField("O'quv bazasi", default=False)

    class Meta:
        managed = False
        db_table = 'organization_services'
        verbose_name = 'Amaldagi xizmatlar'
        verbose_name_plural = 'Amaldagi xizmatlar'

    def __str__(self):
        return f'{self.org_id} xizmatlari'


class Standard(models.Model):
    id = models.IntegerField('№', primary_key=True)
    domain_id = models.IntegerField("Bo'lim №")
    domain_name = models.TextField("Bo'lim")
    standard_number = models.IntegerField('Standart raqami')
    title = models.TextField('Nomi')
    applicability_condition = models.TextField("Qo'llanish sharti", blank=True, null=True)
    service_dependency = models.TextField("Xizmatga bog'liqlik", blank=True, null=True)
    is_gold = models.BooleanField('Gold', default=False)

    class Meta:
        managed = False
        db_table = 'standards'
        verbose_name = 'Standart'
        verbose_name_plural = 'Standartlar'
        ordering = ['domain_id', 'id']

    def __str__(self):
        return f'Standart {self.id}. {self.title}'


class Criterion(models.Model):
    id = models.IntegerField(primary_key=True)
    standard = models.ForeignKey(Standard, on_delete=models.CASCADE, db_column='standard_id', related_name='criteria')
    criterion_number = models.IntegerField('Mezon №')
    description = models.TextField('Tavsif')
    is_critical = models.BooleanField('Kritik (stop-faktor)', default=False)
    # Gold (fayldagi ball 1.3) va SOP — faqat ma'lumot uchun, ball hisobiga ta'sir qilmaydi
    is_gold = models.BooleanField('Gold', default=False)
    sop_required = models.BooleanField('SOP majburiy', default=False)

    class Meta:
        managed = False
        db_table = 'criteria'
        verbose_name = 'Mezon'
        verbose_name_plural = 'Mezonlar'
        ordering = ['standard_id', 'criterion_number']

    def __str__(self):
        return f'{self.standard_id}.{self.criterion_number}'


class AuditSession(models.Model):
    id = models.TextField('Sessiya №', primary_key=True)
    org = models.ForeignKey(Organization, on_delete=models.CASCADE, db_column='org_id', related_name='sessions',
                            verbose_name='Tashkilot')
    submitter_fio = models.TextField("Mas'ul shaxs F.I.O")
    submitter_phone = models.TextField('Telefon')
    status = models.TextField('Holati', choices=STATUS_CHOICES, default='DRAFT')
    total_applicable = models.IntegerField('Amaldagi mezonlar', default=275)
    criteria_yes = models.IntegerField('Bor', default=0)
    criteria_partial = models.IntegerField('Qisman', default=0)
    criteria_no = models.IntegerField("Yo'q", default=0)
    criteria_na = models.IntegerField('Tegishli emas', default=0)
    total_score = models.FloatField('Ball (%)', default=0.0)
    readiness_category = models.TextField('Tayyorgarlik', choices=READINESS_CHOICES, default='NOT_READY')
    has_critical_stop_factors = models.BooleanField('Kritik stop-faktor', default=False)
    submitted_at = models.CharField('Topshirilgan', max_length=32, blank=True, null=True)
    updated_at = models.CharField('Yangilangan', max_length=32, blank=True, null=True)
    final_stage_at = models.CharField("Yakuniy bo'limga o'tgan", max_length=32, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'audit_sessions'
        verbose_name = 'Audit sessiyasi'
        verbose_name_plural = 'Audit sessiyalari'
        ordering = ['-updated_at']

    def __str__(self):
        return self.id


class SessionAnswer(models.Model):
    pk = models.CompositePrimaryKey('session_id', 'criterion_id')
    session = models.ForeignKey(AuditSession, on_delete=models.CASCADE, db_column='session_id', related_name='answers')
    criterion = models.ForeignKey(Criterion, on_delete=models.CASCADE, db_column='criterion_id', related_name='answers')
    answer_value = models.TextField('Javob', choices=ANSWER_CHOICES)
    score_weight = models.FloatField(blank=True, null=True)
    note = models.TextField('Izoh', blank=True, null=True)
    updated_at = models.CharField(max_length=32, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'session_answers'
        verbose_name = 'Javob'
        verbose_name_plural = 'Javoblar'


class SitePage(models.Model):
    """Saytdagi statik sahifalar (masalan, /oferta). Jadval va boshlang'ich matnni Next.js (lib/db.ts) yaratadi."""

    slug = models.TextField('Manzil (slug)', primary_key=True)
    title = models.TextField('Sarlavha')
    content = models.TextField(
        'Matn',
        help_text=(
            "Format: «# » — asosiy sarlavha, «## » — boʻlim sarlavhasi, «### » — kichik sarlavha, "
            "«- » — roʻyxat elementi, boʻsh qator — yangi xatboshi, **matn** — qalin. HTML ishlatilmaydi."
        ),
    )
    updated_at = models.CharField('Yangilangan', max_length=32, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'site_pages'
        verbose_name = 'Sahifa'
        verbose_name_plural = 'Sahifalar (oferta va b.)'

    def __str__(self):
        return self.title
