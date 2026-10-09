"""
CLAMO akkreditatsiya tizimi uchun Django admin paneli.

Ikki baza:
  - default: admin.db — Django foydalanuvchilari, sessiyalar, admin loglari
  - clamo:   ../clamo_accreditation.db — Next.js ilovasining asosiy bazasi (managed=False, sxemaga tegilmaydi)
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'dev-only-insecure-key-change-me')
DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'
if not DEBUG and SECRET_KEY.startswith('dev-only'):
    raise RuntimeError('Production uchun DJANGO_SECRET_KEY muhit o\'zgaruvchisini o\'rnating')

# Next.js sayt manzili — admin'dan sahifalarni (masalan, /oferta) ochish uchun
CLAMO_SITE_URL = os.environ.get('CLAMO_SITE_URL', 'http://localhost:3000')

ALLOWED_HOSTS = [h for h in os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h]
CSRF_TRUSTED_ORIGINS = [o for o in os.environ.get('DJANGO_CSRF_TRUSTED_ORIGINS', '').split(',') if o]

INSTALLED_APPS = [
    'jazzmin',  # clamo-backend bilan bir xil admin temasi; django.contrib.admin'dan oldin turishi shart
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'accreditation',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'clamo_admin.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'clamo_admin.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': os.environ.get('DJANGO_ADMIN_DB_PATH', BASE_DIR / 'admin.db'),
    },
    'clamo': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': os.environ.get('CLAMO_DB_PATH', BASE_DIR.parent / 'clamo_accreditation.db'),
        'OPTIONS': {
            # Next.js bilan bir vaqtda yozilganda "database is locked" bo'lmasligi uchun
            'timeout': 10,
            'init_command': 'PRAGMA journal_mode=WAL;',
        },
    },
}
DATABASE_ROUTERS = ['accreditation.routers.ClamoRouter']

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'uz'
TIME_ZONE = 'Asia/Tashkent'
USE_I18N = True
USE_TZ = True

# Login sahifasi to'g'ridan-to'g'ri ochilganda kirgandan keyin admin bosh sahifasiga
LOGIN_URL = '/admin/login/'
LOGIN_REDIRECT_URL = '/admin/'

STATIC_URL = os.environ.get('DJANGO_STATIC_URL', '/static/')
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# django-jazzmin (clamo-backend bilan bir xil tema): faqat brending va ikonkalar, qolgani standart
JAZZMIN_SETTINGS = {
    'site_title': 'CLAMO Admin',
    'site_header': 'CLAMO',
    'site_brand': 'Admin',
    'site_logo': 'clamo/logo.png',
    'login_logo': 'clamo/logo.png',
    'site_logo_classes': 'brand-image-clamo',
    'welcome_sign': 'CLAMO Akkreditatsiya — Administrator paneli',
    'copyright': 'CLAMO',
    'search_model': ['accreditation.AuditSession', 'accreditation.Organization'],
    'order_with_respect_to': [
        'accreditation', 'accreditation.AuditSession', 'accreditation.Organization',
        'accreditation.Standard', 'accreditation.Criterion', 'accreditation.SitePage', 'auth',
    ],
    'icons': {
        'auth': 'fas fa-users-cog',
        'auth.user': 'fas fa-user',
        'auth.Group': 'fas fa-users',
        'accreditation.AuditSession': 'fas fa-clipboard-check',
        'accreditation.Organization': 'fas fa-hospital',
        'accreditation.Standard': 'fas fa-book-medical',
        'accreditation.Criterion': 'fas fa-list-ol',
        'accreditation.SitePage': 'fas fa-file-contract',
    },
    'custom_css': 'clamo/admin.css',
    'changeform_format': 'horizontal_tabs',
}

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
