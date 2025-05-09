# ==============================================================================
# app.py - Application Flask pour la Gestion des Formations Microsoft 365
# Version: 1.1.11 - Correction finale indentation modèles
# ==============================================================================

# --- Imports ---
import os
import sys
import functools
import random
import time
import psycopg2
from datetime import datetime, timedelta, UTC, date, time as time_obj
import logging
from logging.handlers import RotatingFileHandler
import json

from flask import (
    Flask, render_template, request, redirect, url_for,
    flash, jsonify, make_response, current_app, send_from_directory
)
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import (
    LoginManager, UserMixin, login_user, login_required,
    logout_user, current_user
)
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from sqlalchemy.exc import IntegrityError, SQLAlchemyError, OperationalError, TimeoutError
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy import func, text, select, update, delete

from jinja2 import TemplateNotFound 

from werkzeug.exceptions import ServiceUnavailable, RequestEntityTooLarge
from werkzeug.routing import BuildError
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from ics import Calendar, Event
from ics.alarm import DisplayAlarm
from whitenoise import WhiteNoise

# --- Async Mode Patching ---
try:
    import gevent.monkey
    gevent.monkey.patch_all()
    ASYNC_MODE = 'gevent'
    print("Gevent monkey patching appliqué.")
except ImportError:
    try:
        import eventlet
        eventlet.monkey_patch()
        ASYNC_MODE = 'eventlet'
        print("Gevent non trouvé. Eventlet monkey patching appliqué.")
    except ImportError:
        ASYNC_MODE = 'threading'
        print(f"Ni gevent ni eventlet trouvés. Mode asynchrone: {ASYNC_MODE}")

psycopg2.extensions.register_type(psycopg2.extensions.UNICODE)
psycopg2.extensions.register_type(psycopg2.extensions.UNICODEARRAY)

app = Flask(__name__)

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'default_secret_key_for_dev_v4')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get("DATABASE_URL", "postgresql://xvcyuaga:rfodwjclemtvhwvqsrpp@alpha.europe.mkdb.sh:5432/usdtdsgq")
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ECHO'] = False 
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "client_encoding": "UTF8", "connect_args": { "options": "-c client_encoding=utf8" },
    'pool_size': 1, 'max_overflow': 0, 'pool_timeout': 10, 'pool_recycle': 280, 'pool_pre_ping': True
}
app.config.from_mapping({ "CACHE_TYPE": "SimpleCache", "CACHE_DEFAULT_TIMEOUT": 60 })
UPLOAD_FOLDER = os.path.join(app.root_path, 'uploads')
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
if not os.path.exists(UPLOAD_FOLDER):
    try: os.makedirs(UPLOAD_FOLDER); print(f"Dossier d'upload créé: {UPLOAD_FOLDER}")
    except OSError as e: print(f"ERREUR création dossier upload: {e}")

static_folder_root = os.path.join(os.path.dirname(__file__), 'static')
app.wsgi_app = WhiteNoise(app.wsgi_app, root=static_folder_root, prefix='static/')

db = SQLAlchemy(app)
migrate = Migrate(app, db)
login_manager = LoginManager()
cache = Cache(app)
limiter = Limiter(key_func=get_remote_address, default_limits=["200 per day", "50 per hour"])
login_manager.init_app(app)
limiter.init_app(app)
cache.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = "Veuillez vous connecter pour accéder à cette page."
login_manager.login_message_category = "info"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode=ASYNC_MODE, engineio_logger=False, logger=False, ping_timeout=30000, ping_interval=35000, manage_session=False)

def configure_logging(app_instance):
    log_level = logging.DEBUG if app_instance.debug else logging.INFO
    app_instance.logger.handlers = []
    logging.getLogger('sqlalchemy.engine').handlers = []
    logging.getLogger('socketio').handlers = []
    logging.getLogger('engineio').handlers = []
    formatter = logging.Formatter('%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]')
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)
    app_instance.logger.addHandler(console_handler)
    app_instance.logger.setLevel(log_level)
    if not app_instance.debug:
        logs_dir_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
        if not os.path.exists(logs_dir_path):
            try: os.makedirs(logs_dir_path)
            except OSError as e: app_instance.logger.error(f"Impossible de créer le dossier de logs {logs_dir_path}: {e}"); return
        app_log_file = os.path.join(logs_dir_path, 'app.log')
        try:
            file_handler = RotatingFileHandler(app_log_file, maxBytes=5*1024*1024, backupCount=5, encoding='utf-8')
            file_handler.setFormatter(formatter); file_handler.setLevel(logging.INFO)
            app_instance.logger.addHandler(file_handler)
            app_instance.logger.info('Logging de production initialisé (fichiers).')
        except Exception as e: app_instance.logger.error(f"Erreur config logging fichier: {e}")
    else:
        logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
        app_instance.logger.info('Logging de développement initialisé (console).')
configure_logging(app)

@app.context_processor
def inject_global_template_vars():
    # Note: get_all_salles added here as per updated_app.py
    return dict(
        debug_mode=app.debug,
        now=datetime.now(UTC),
        app_name="Formation Microsoft 365", # Updated app_name
        ALLOWED_EXTENSIONS=ALLOWED_EXTENSIONS,
        get_all_themes=get_all_themes, 
        get_all_services_with_participants=get_all_services_with_participants,
        get_all_salles=get_all_salles 
    )

@app.teardown_appcontext
def shutdown_session_proper(exception=None):
    if hasattr(db, 'session'):
        if exception: 
            app.logger.debug(f"Teardown: Exception détectée, rollback de la session DB: {exception}")
            try: db.session.rollback()
            except Exception as rb_e: app.logger.error(f"Teardown: Erreur pendant le rollback: {rb_e}")
        try: db.session.remove()
        except Exception as e: app.logger.error(f"Teardown: Erreur lors du retrait de la session: {e}")

@app.before_request
def limit_connections_if_needed(): # From original_app.py
    try:
        if request.path.startswith('/static/'): return None
        connection_errors = getattr(app, '_connection_errors', 0)
        if connection_errors > 10:
            if hasattr(app, '_last_connection_error') and (datetime.now(UTC) - app._last_connection_error).total_seconds() > 300:
                app._connection_errors = 0
                return None
            if request.path.startswith('/api/') and not request.path.endswith('_essential'):
                return jsonify({"error": "Service temporarily at capacity", "message": "Server load high."}), 429
    except Exception as e: app.logger.error(f"Error in limiting connections: {e}")
    return None

def db_operation_with_retry(max_retries=3, retry_delay=0.5, retry_on_exceptions=(OperationalError, TimeoutError), fail_on_exceptions=(IntegrityError, SQLAlchemyError)):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0; last_exception = None
            while retries < max_retries:
                try: return func(*args, **kwargs)
                except retry_on_exceptions as e:
                    retries += 1; last_exception = e
                    app.logger.warning(f"DB op '{func.__name__}' échec (tentative {retries}/{max_retries}): {type(e).__name__} - {e}")
                    try: db.session.rollback()
                    except Exception as rb_ex: app.logger.error(f"Rollback error in retry decorator for '{func.__name__}': {rb_ex}")
                    if retries >= max_retries: app.logger.error(f"Max retries DB op '{func.__name__}'. Erreur: {e}"); raise ServiceUnavailable(f"Service DB indisponible.")
                    time.sleep((retry_delay * (2 ** (retries -1))) + random.uniform(0, retry_delay * 0.25))
                except fail_on_exceptions as e: db.session.rollback(); app.logger.error(f"SQLAlchemyError (non réessayé) DB op '{func.__name__}': {e}", exc_info=True); raise
                except Exception as e: db.session.rollback(); app.logger.error(f"Erreur Python inattendue DB op '{func.__name__}': {e}", exc_info=True); raise
            if last_exception: raise ServiceUnavailable(f"Service DB indisponible après {max_retries} tentatives. Erreur: {last_exception}")
            raise ServiceUnavailable(f"Service DB indisponible après {max_retries} tentatives (raison inconnue).")
        return wrapper
    return decorator

# --- Modèles de Données ---
class Service(db.Model):
    __tablename__ = 'service'; id = db.Column(db.String(20), primary_key=True); nom = db.Column(db.String(100), nullable=False, unique=True); couleur = db.Column(db.String(7), nullable=False, default='#6c757d'); responsable = db.Column(db.String(100), nullable=False); email_responsable = db.Column(db.String(100), nullable=False); participants = db.relationship('Participant', backref='service', lazy='selectin'); users = db.relationship('User', backref='service', lazy='selectin')
    def __repr__(self): return f'<Service {self.id}: {self.nom}>'

class Salle(db.Model):
    __tablename__ = 'salle'; id = db.Column(db.Integer, primary_key=True); nom = db.Column(db.String(100), nullable=False, unique=True); capacite = db.Column(db.Integer, default=10, nullable=False); lieu = db.Column(db.String(200)); description = db.Column(db.Text); sessions = db.relationship('Session', backref='salle', lazy='dynamic')
    def __repr__(self): return f'<Salle {self.id}: {self.nom}>'

class Theme(db.Model):
    __tablename__ = 'theme'; id = db.Column(db.Integer, primary_key=True); nom = db.Column(db.String(100), nullable=False, unique=True); description = db.Column(db.Text); sessions = db.relationship('Session', backref='theme', lazy='selectin'); documents = db.relationship('Document', backref='theme', lazy='selectin', cascade="all, delete-orphan")
    def __repr__(self): return f'<Theme {self.id}: {self.nom}>'

class Document(db.Model):
    __tablename__ = 'document'; id = db.Column(db.Integer, primary_key=True); filename = db.Column(db.String(255), nullable=False, unique=True); original_filename = db.Column(db.String(255), nullable=False); description = db.Column(db.Text); upload_date = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False); theme_id = db.Column(db.Integer, db.ForeignKey('theme.id'), index=True); uploader_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True); file_type = db.Column(db.String(50)); uploader = db.relationship('User', backref=db.backref('uploaded_documents', lazy='dynamic'))
    def __repr__(self): return f'<Document {self.id}: {self.original_filename}>'

class Session(db.Model):
    __tablename__ = 'session'
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, index=True)
    heure_debut = db.Column(db.Time, nullable=False)
    heure_fin = db.Column(db.Time, nullable=False)
    theme_id = db.Column(db.Integer, db.ForeignKey('theme.id'), nullable=False, index=True)
    max_participants = db.Column(db.Integer, default=10, nullable=False)
    salle_id = db.Column(db.Integer, db.ForeignKey('salle.id'), nullable=True, index=True)
    inscriptions = db.relationship('Inscription', backref='session', lazy='selectin', cascade="all, delete-orphan")
    liste_attente = db.relationship('ListeAttente', backref='session', lazy='selectin', cascade="all, delete-orphan")

    def get_places_restantes(self, confirmed_count=None):
        try:
            if confirmed_count is None:
                if hasattr(self, 'inscriptions') and self.inscriptions is not None:
                    confirmed_count = sum(1 for insc in self.inscriptions if insc.statut == 'confirmé')
                else: 
                    confirmed_count = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == self.id, Inscription.statut == 'confirmé').scalar() or 0
            max_p = self.max_participants if self.max_participants is not None else 10
            return max(0, max_p - confirmed_count)
        except Exception as e:
            app.logger.error(f"Erreur calcul places restantes S:{self.id}: {e}")
            return 0

    @property
    def formatage_date(self):
        try:
            jours = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
            mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
            return f"{jours[self.date.weekday()]} {self.date.day} {mois[self.date.month-1]} {self.date.year}"
        except Exception:
            return self.date.strftime('%d/%m/%Y') if self.date else "Date N/A"

    @property
    def formatage_horaire(self):
        try:
            debut = f"{self.heure_debut.hour:02d}h{self.heure_debut.minute:02d}"
            fin = f"{self.heure_fin.hour:02d}h{self.heure_fin.minute:02d}"
            return f"{debut}–{fin}"
        except Exception:
            return f"{self.heure_debut.strftime('%H:%M')}–{self.heure_fin.strftime('%H:%M')}" if self.heure_debut and self.heure_fin else "Horaire N/A"

    @property
    def formatage_ics(self):
        try:
            if not isinstance(self.date, date) or not isinstance(self.heure_debut, time_obj) or not isinstance(self.heure_fin, time_obj):
                app.logger.error(f"ICS Formatting Error S:{self.id}: Invalid date/time types.")
                now_utc = datetime.now(UTC); return now_utc, now_utc + timedelta(hours=1)
            start_utc = datetime.combine(self.date, self.heure_debut).replace(tzinfo=UTC)
            end_utc = datetime.combine(self.date, self.heure_fin).replace(tzinfo=UTC)
            if end_utc <= start_utc:
                app.logger.warning(f"ICS Formatting Warning S:{self.id}: End time not after start. Adjusting.")
                end_utc = start_utc + timedelta(hours=1)
            return start_utc, end_utc
        except Exception as e:
            app.logger.error(f"Critical error in formatage_ics for S:{self.id}: {e}", exc_info=True)
            now_utc = datetime.now(UTC); return now_utc, now_utc + timedelta(hours=1)

    def __repr__(self):
        theme_nom = self.theme.nom if self.theme else "N/A"
        date_str = self.date.strftime("%Y-%m-%d") if self.date else "N/A"
        return f'<Session {self.id} - {theme_nom} le {date_str}>'
        
class Participant(db.Model):
    __tablename__ = 'participant'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    prenom = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), nullable=False, unique=True, index=True)
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=False, index=True)
    inscriptions = db.relationship('Inscription', backref='participant', lazy='selectin', cascade="all, delete-orphan")
    liste_attente = db.relationship('ListeAttente', backref='participant', lazy='selectin', cascade="all, delete-orphan")
    def __repr__(self): return f'<Participant {self.id}: {self.prenom} {self.nom}>'

class Inscription(db.Model): __tablename__ = 'inscription'; id = db.Column(db.Integer, primary_key=True); participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False, index=True); session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False, index=True); date_inscription = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False); statut = db.Column(db.String(20), default='en attente', nullable=False, index=True); validation_responsable = db.Column(db.Boolean, default=False, nullable=False); presence = db.Column(db.Boolean, nullable=True); notification_envoyee = db.Column(db.Boolean, default=False, nullable=False); __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_inscription'),)
class ListeAttente(db.Model): __tablename__ = 'liste_attente'; id = db.Column(db.Integer, primary_key=True); participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False, index=True); session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False, index=True); date_inscription = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False); position = db.Column(db.Integer, nullable=False); notification_envoyee = db.Column(db.Boolean, default=False, nullable=False); __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_liste_attente'),)

class Activite(db.Model):
    __tablename__ = 'activite'
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(50), nullable=False, index=True)
    description = db.Column(db.Text, nullable=False)
    details = db.Column(db.Text, nullable=True)
    date = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False, index=True)
    utilisateur_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    utilisateur = db.relationship('User', backref='activites_generees', foreign_keys=[utilisateur_id])

    @property
    def date_relative(self):
        now = datetime.now(UTC)
        aware_date = self.date
        if self.date and self.date.tzinfo is None: aware_date = self.date.replace(tzinfo=UTC)
        if not isinstance(aware_date, datetime): return "Date invalide"
        try:
            if aware_date > now: return f"le {aware_date.strftime('%d/%m/%Y à %H:%M')}"
            diff = now - aware_date; seconds = diff.total_seconds()
            if seconds < 5: return "à l'instant"; 
            if seconds < 60: s = 's' if int(seconds) >= 2 else ''; return f"il y a {int(seconds)} seconde{s}"
            if seconds < 3600: m = int(seconds // 60); s = 's' if m >= 2 else ''; return f"il y a {m} minute{s}"
            if seconds < 86400: h = int(seconds // 3600); s = 's' if h >= 2 else ''; return f"il y a {h} heure{s}"
            days = int(seconds // 86400)
            if days == 1: return "hier"; 
            if days <= 7: return f"il y a {days} jours"
            return f"le {aware_date.strftime('%d/%m/%Y')}"
        except Exception as e: app.logger.error(f"Erreur date_relative act {self.id}: {e}"); return "Date inconnue"
    def __repr__(self): return f'<Activite {self.id} - Type:{self.type} Date:{self.date.strftime("%Y-%m-%d %H:%M") if self.date else "N/A"}>'

class User(UserMixin, db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False) # Increased length from original
    email = db.Column(db.String(100), unique=True, nullable=False)
    role = db.Column(db.String(20), default='user', nullable=False, index=True)
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f'<User {self.id}: {self.username} ({self.role})>'

@login_manager.user_loader
def load_user(user_id):
    try: return db.session.get(User, int(user_id))
    except Exception as e: app.logger.error(f"Erreur load_user {user_id}: {e}"); return None

# --- Fonctions Helper ---
@db_operation_with_retry(max_retries=3) # From original_app.py
def check_db_connection():
    try: db.session.execute(text("SELECT 1")); return True
    except Exception as e: app.logger.error(f"DB Connection health check failed: {e}"); db.session.rollback(); return False

def generate_ics(session, participant, salle=None): # From original_app.py
    app.logger.info(f"--- generate_ics called ---")
    app.logger.info(f"Attempting for S_ID:{getattr(session, 'id', 'None')}, P_ID:{getattr(participant, 'id', 'None')}")
    try:
        if not session: app.logger.error("ICS Gen Error: Session object is None."); return None
        if not hasattr(session, 'theme') or not session.theme or not hasattr(session.theme, 'nom') or not session.theme.nom: app.logger.error(f"ICS Gen Error: Session S_ID:{getattr(session, 'id', 'N/A')} - theme or theme.nom is missing or invalid."); return None
        if not participant: app.logger.error("ICS Gen Error: Participant object is None."); return None
        if not hasattr(participant, 'prenom') or not participant.prenom or not hasattr(participant, 'nom') or not participant.nom: app.logger.error(f"ICS Gen Error: Participant P_ID:{getattr(participant, 'id', 'N/A')} - prenom or nom is missing."); return None
        cal = Calendar(); event = Event()
        date_debut_utc, date_fin_utc = session.formatage_ics
        if not isinstance(date_debut_utc, datetime) or not isinstance(date_fin_utc, datetime) or date_debut_utc.tzinfo != UTC or date_fin_utc.tzinfo != UTC: app.logger.error(f"ICS Gen Error S_ID:{session.id}: formatage_ics did not return valid UTC datetime objects."); return None
        event.name = f"Formation: {session.theme.nom}"; event.begin = date_debut_utc; event.end = date_fin_utc
        description_parts = ["FORMATION MICROSOFT 365 - ANECOOP FRANCE", f"\nThème: {session.theme.nom}"]
        if hasattr(session, 'theme') and session.theme and hasattr(session.theme, 'description') and session.theme.description: description_parts.append(f"Détails du thème: {session.theme.description}")
        description_parts.extend([f"\nDate: {session.formatage_date}", f"Horaire: {session.formatage_horaire}" ])
        location_str = "Salle non définie"
        if salle and hasattr(salle, 'nom') and salle.nom:
            location_str = salle.nom; description_parts.append(f"\nLieu: {salle.nom}")
            if hasattr(salle, 'lieu') and salle.lieu: description_parts.append(f"Emplacement précis: {salle.lieu}")
        else: description_parts.append("\nLieu: Salle non définie")
        event.location = location_str
        description_parts.append(f"\nParticipant: {participant.prenom} {participant.nom}"); event.description = "\n".join(description_parts)
        event.uid = f"session-{session.id}-participant-{participant.id}-{date_debut_utc.strftime('%Y%m%dT%H%M%SZ')}@anecoop-france.com"
        event.created = datetime.now(UTC); event.last_modified = datetime.now(UTC); event.status = "CONFIRMED"
        alarm = DisplayAlarm(trigger=timedelta(hours=-1)); alarm.description = f"Rappel: Formation {session.theme.nom}"; event.alarms.add(alarm)
        cal.events.add(event); serialized_cal = cal.serialize()
        app.logger.info(f"ICS generated successfully for S_ID:{session.id}, P_ID:{participant.id}. Size: {len(serialized_cal)} bytes.")
        return serialized_cal
    except AttributeError as ae: app.logger.error(f"ICS Gen AttributeError S_ID:{getattr(session, 'id', 'N/A')}, P_ID:{getattr(participant, 'id', 'N/A')}: {ae}", exc_info=True); return None
    except Exception as e: app.logger.error(f"Critical error during ICS generation for S_ID:{getattr(session, 'id', 'N/A')}, P_ID:{getattr(participant, 'id', 'N/A')}: {e}", exc_info=True); return None

@db_operation_with_retry(max_retries=3) # From original_app.py
def check_waitlist(session_id):
    try:
        session = db.session.get(Session, session_id)
        if not session: app.logger.warning(f"check_waitlist called for non-existent session {session_id}"); return False
        if session.get_places_restantes() <= 0: return False
        next_in_line = ListeAttente.query.filter_by(session_id=session_id, notification_envoyee=False).order_by(ListeAttente.position).first()
        if next_in_line:
            next_in_line.notification_envoyee = True; db.session.commit()
            socketio.emit('notification', {'event': 'place_disponible', 'message': f"Une place s'est libérée pour la formation '{session.theme.nom}' du {session.formatage_date}!", 'session_id': session_id, 'participant_id': next_in_line.participant_id}, room=f'user_{next_in_line.participant_id}')
            # Using the new add_activity function
            add_activity('notification', f'Notification place dispo envoyée', f'Session: {session.theme.nom}, Part: {next_in_line.participant.prenom} {next_in_line.participant.nom}')
            app.logger.info(f"Notified P:{next_in_line.participant_id} for S:{session_id} waitlist opening.")
            return True
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"DB error during check_waitlist for S:{session_id}: {e}")
    except Exception as e: db.session.rollback(); app.logger.error(f"Unexpected error during check_waitlist for S:{session_id}: {e}", exc_info=True)
    return False

# add_activity from updated_app.py
def add_activity(type_activite, description, details=None, user=None):
    try:
        log_user = user if user else current_user; user_id_for_db = None
        if log_user and hasattr(log_user, 'is_authenticated') and log_user.is_authenticated: user_id_for_db = log_user.id
        activite = Activite(type=type_activite, description=description, details=details, utilisateur_id=user_id_for_db)
        db.session.add(activite); db.session.commit(); db.session.refresh(activite)
        # Ensure utilisateur is loaded for username and date_relative is computed
        user_username = activite.utilisateur.username if activite.utilisateur else None
        date_rel = activite.date_relative # Compute after commit and refresh
        socketio.emit('nouvelle_activite', {'id': activite.id, 'type': activite.type, 'description': activite.description, 'details': activite.details, 'date_relative': date_rel, 'user': user_username}, room='general')
        cache.delete_memoized(get_recent_activities); cache.delete('dashboard_essential_data_v3.2')
        return True
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur ajout activité '{type_activite}': {e}", exc_info=True); return False


@db_operation_with_retry(max_retries=3) # From original_app.py
def update_theme_names():
    with app.app_context():
        try:
            changes_made = False
            onedrive_theme = Theme.query.filter(Theme.nom.like('%OneDrive%')).first()
            target_name_files = 'Gérer mes fichiers (OneDrive/SharePoint)'; target_desc_files = 'Apprenez à organiser et partager vos fichiers avec OneDrive et SharePoint.'
            if onedrive_theme and (onedrive_theme.nom != target_name_files or onedrive_theme.description != target_desc_files): onedrive_theme.nom = target_name_files; onedrive_theme.description = target_desc_files; changes_made = True; app.logger.info(f"Standardized theme: {target_name_files}")
            collaborer_theme = Theme.query.filter(Theme.nom.like('%Collaborer%')).first()
            target_name_collab = 'Collaborer avec Teams'; target_desc_collab = 'Découvrez comment collaborer sur des documents avec Microsoft Teams.'
            if collaborer_theme and (collaborer_theme.nom != target_name_collab or collaborer_theme.description != target_desc_collab): collaborer_theme.nom = target_name_collab; collaborer_theme.description = target_desc_collab; changes_made = True; app.logger.info(f"Standardized theme: {target_name_collab}")
            if changes_made: db.session.commit(); cache.delete_memoized(get_all_themes); print("Noms/descriptions des thèmes standardisés.")
            else: print("Noms/descriptions des thèmes déjà standardisés.")
        except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"DB error standardizing theme names: {e}"); print("Erreur DB lors de la standardisation des thèmes.")
        except Exception as e: db.session.rollback(); app.logger.error(f"Unexpected error standardizing theme names: {e}"); print("Erreur inattendue lors de la standardisation des thèmes.")

@cache.memoize(timeout=300)
@db_operation_with_retry(max_retries=3)
def get_all_themes():
@cache.memoize(timeout=300) @db_operation_with_retry(max_retries=3)
def get_all_services_with_participants(): return Service.query.options(selectinload(Service.participants)).order_by(Service.nom).all()
@cache.memoize(timeout=180) @db_operation_with_retry(max_retries=3)
def get_all_salles(): return Salle.query.order_by(Salle.nom).all()
@cache.memoize(timeout=180) @db_operation_with_retry(max_retries=3)
def get_all_participants_with_service(): return Participant.query.options(joinedload(Participant.service)).order_by(Participant.nom, Participant.prenom).all()
@cache.memoize(timeout=60) @db_operation_with_retry(max_retries=2)
def get_recent_activities(limit=10): return Activite.query.options(joinedload(Activite.utilisateur)).order_by(Activite.date.desc()).limit(limit).all()

def allowed_file(filename): # From original_app.py
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- WebSocket Event Handlers --- (From original_app.py)
@socketio.on('connect')
def handle_connect():
    app.logger.info(f'Client connected (polling): {request.sid}')
    emit('status', {'msg': 'Connected via polling'})
    join_room('general')

@socketio.on('disconnect')
def handle_disconnect():
    app.logger.info(f'Client disconnected (polling): {request.sid}')

@socketio.on('join')
def handle_join(data):
    room = data.get('room', 'general'); sid = request.sid
    join_room(room); app.logger.info(f'Client {sid} joined room (polling): {room}')
    emit('status', {'msg': f'Joined room {room}'}, room=sid)

@socketio.on('heartbeat')
def handle_heartbeat(data):
    emit('heartbeat_response', {'timestamp': datetime.now(UTC).timestamp()})

# --- Flask Routes ---
@app.route('/')
def index(): return redirect(url_for('dashboard'))

@app.route('/login', methods=['GET', 'POST']) # From original_app.py
@db_operation_with_retry(max_retries=3)
def login():
    if current_user.is_authenticated: return redirect(url_for('dashboard'))
    if request.method == 'POST':
        username = request.form.get('username'); password = request.form.get('password'); remember = True
        if not username or not password: flash('Nom d\'utilisateur et mot de passe requis.', 'warning'); return render_template('login.html')
        try:
            user = User.query.filter(func.lower(User.username) == func.lower(username)).first()
            if user and user.check_password(password):
                login_user(user, remember=remember); add_activity('connexion', f'Connexion de {user.username}', user=user)
                next_page = request.args.get('next')
                if next_page and next_page.startswith('/') and not next_page.startswith('//'): return redirect(next_page)
                return redirect(url_for('dashboard'))
            else: flash('Nom d\'utilisateur ou mot de passe incorrect.', 'danger')
        except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"DB error during login for user {username}: {e}"); flash("Erreur base de données lors de la connexion.", "danger")
        except Exception as e: db.session.rollback(); app.logger.error(f"Unexpected error during login for user {username}: {e}", exc_info=True); flash("Erreur interne du serveur.", "danger")
    return render_template('login.html')

@app.route('/logout') # From original_app.py
@login_required
def logout():
    try: add_activity('deconnexion', f'Déconnexion de {current_user.username}', user=current_user); logout_user(); flash('Vous avez été déconnecté avec succès.', 'success')
    except Exception as e: app.logger.error(f"Error during logout for user {current_user.username}: {e}", exc_info=True); flash("Erreur lors de la déconnexion.", "warning")
    return redirect(url_for('login'))

@app.route('/profile') # From original_app.py
@login_required 
@db_operation_with_retry(max_retries=2)
def profile():
    app.logger.info(f"Utilisateur '{current_user.username}' accède à sa page de profil.")
    return render_template('profile.html', user_profile=current_user)

@app.route('/mes_inscriptions') # From original_app.py
@login_required 
@db_operation_with_retry(max_retries=2)
def mes_inscriptions():
    app.logger.info(f"Utilisateur '{current_user.username}' accède à la page 'Mes Inscriptions'.")
    try:
        participant = Participant.query.filter(func.lower(Participant.email) == func.lower(current_user.email)).first()
        if not participant:
            flash("Profil participant non trouvé pour cet utilisateur. Veuillez contacter l'administrateur.", "warning")
            return render_template('mes_inscriptions.html', confirmed_inscriptions=[], pending_inscriptions=[], waitlist_entries=[])
        participant_id = participant.id
        confirmed_inscriptions = Inscription.query.options(joinedload(Inscription.session).joinedload(Session.theme), joinedload(Inscription.session).joinedload(Session.salle)).filter(Inscription.participant_id == participant_id, Inscription.statut == 'confirmé').order_by(Session.date.asc(), Session.heure_debut.asc()).all()
        pending_inscriptions = Inscription.query.options(joinedload(Inscription.session).joinedload(Session.theme), joinedload(Inscription.session).joinedload(Session.salle)).filter(Inscription.participant_id == participant_id, Inscription.statut == 'en attente').order_by(Session.date.asc(), Session.heure_debut.asc()).all()
        waitlist_entries = ListeAttente.query.options(joinedload(ListeAttente.session).joinedload(Session.theme), joinedload(ListeAttente.session).joinedload(Session.salle)).filter(ListeAttente.participant_id == participant_id).order_by(Session.date.asc(), Session.heure_debut.asc(), ListeAttente.position.asc()).all()
        return render_template('mes_inscriptions.html', confirmed_inscriptions=confirmed_inscriptions, pending_inscriptions=pending_inscriptions, waitlist_entries=waitlist_entries, participant=participant)
    except SQLAlchemyError as e:
        db.session.rollback(); app.logger.error(f"Erreur DB chargement 'Mes Inscriptions' pour {current_user.username}: {e}", exc_info=True); flash("Erreur de base de données lors du chargement de vos inscriptions.", "danger")
    except Exception as e:
        db.session.rollback(); app.logger.error(f"Erreur inattendue chargement 'Mes Inscriptions' pour {current_user.username}: {e}", exc_info=True); flash("Une erreur interne est survenue.", "danger")
    return render_template('mes_inscriptions.html', confirmed_inscriptions=[], pending_inscriptions=[], waitlist_entries=[], participant=None)

@app.route('/generer_invitation/<int:inscription_id>') # From original_app.py
@db_operation_with_retry(max_retries=2)
def generer_invitation(inscription_id):
    app.logger.info(f"Tentative de génération ICS pour Inscription ID: {inscription_id}")
    try:
        inscription = db.session.query(Inscription).options(joinedload(Inscription.participant), joinedload(Inscription.session).joinedload(Session.theme), joinedload(Inscription.session).joinedload(Session.salle)).get(inscription_id)
        if not inscription: flash("Inscription non trouvée.", "danger"); return redirect(request.referrer or url_for('dashboard'))
        if inscription.statut != 'confirmé': flash("L'invitation ne peut être générée que pour une inscription confirmée.", "warning"); return redirect(request.referrer or url_for('dashboard'))
        if not inscription.participant or not inscription.session or not inscription.session.theme: flash("Données participant ou session manquantes pour générer l'invitation.", "danger"); app.logger.error(f"ICS Gen Error: Missing data for Inscription ID {inscription_id}"); return redirect(request.referrer or url_for('dashboard'))
        ics_content = generate_ics(inscription.session, inscription.participant, inscription.session.salle)
        if ics_content is None: flash("Erreur lors de la génération du fichier d'invitation.", "danger"); app.logger.error(f"generate_ics returned None for Inscription ID {inscription_id}"); return redirect(request.referrer or url_for('dashboard'))
        response = make_response(ics_content); filename = f"formation_{inscription.session.theme.nom.replace(' ', '_')}_{inscription.session.date.strftime('%Y%m%d')}.ics"; response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'; response.headers['Content-Type'] = 'text/calendar; charset=utf-8'
        add_activity('telecharger_invitation', f'Téléchargement invitation: {inscription.participant.prenom} {inscription.participant.nom}', f'Session: {inscription.session.theme.nom}', user=current_user)
        app.logger.info(f"ICS généré et envoyé pour Inscription ID: {inscription_id}")
        return response
    except SQLAlchemyError as e:
        db.session.rollback(); app.logger.error(f"Erreur DB lors de la génération ICS pour Inscription ID {inscription_id}: {e}", exc_info=True); flash("Erreur base de données lors de la génération de l'invitation.", "danger")
    except Exception as e:
        db.session.rollback(); app.logger.error(f"Erreur inattendue lors de la génération ICS pour Inscription ID {inscription_id}: {e}", exc_info=True); flash("Une erreur interne est survenue lors de la génération de l'invitation.", "danger")
    return redirect(request.referrer or url_for('dashboard'))

@app.route('/dashboard') # From updated_app.py
@db_operation_with_retry(max_retries=3)
def dashboard():
    app.logger.info(f"User '{current_user.username if current_user.is_authenticated else 'Anonymous'}' accessing /dashboard (with initial data).")
    template_data_for_view = []
    try:
        sessions_from_db = Session.query.options(
            selectinload(Session.theme), 
            selectinload(Session.salle),
            selectinload(Session.inscriptions).selectinload(Inscription.participant).selectinload(Participant.service),
            selectinload(Session.liste_attente)
        ).order_by(Session.date, Session.heure_debut).limit(20).all()

        for s_obj in sessions_from_db:
            inscrits_confirmes_list = [i for i in s_obj.inscriptions if i.statut == 'confirmé']
            pending_inscriptions_list = [i for i in s_obj.inscriptions if i.statut == 'en attente']
            inscrits_count = len(inscrits_confirmes_list)
            pending_count = len(pending_inscriptions_list)
            attente_count = len(s_obj.liste_attente)
            max_p = s_obj.max_participants if s_obj.max_participants is not None else 10
            
            template_data_for_view.append({
                'obj': s_obj, 'places_restantes': max(0, max_p - inscrits_count),
                'inscrits_confirmes_count': inscrits_count, 'liste_attente_count': attente_count,
                'pending_count': pending_count,
                'loaded_inscrits_confirmes': sorted(inscrits_confirmes_list, key=lambda i: i.participant.nom.lower() if i.participant else ''),
                'loaded_pending_inscriptions': sorted(pending_inscriptions_list, key=lambda i: i.participant.nom.lower() if i.participant else ''),
                'loaded_liste_attente': sorted(s_obj.liste_attente, key=lambda la: la.position)
            })
        all_participants_for_modal = get_all_participants_with_service()
        all_services_for_modal = get_all_services_with_participants()
        all_salles_for_modal = get_all_salles()
        template_context = {
            'page_title': 'Tableau de Bord - Formation Microsoft 365',
            'sessions_data': template_data_for_view, 'participants': all_participants_for_modal, 
            'services': all_services_for_modal, 'salles': all_salles_for_modal,
            'Inscription': Inscription, 'ListeAttente': ListeAttente,
        }
        return render_template('dashboard.html', **template_context)
    except TemplateNotFound as e: app.logger.error(f"TemplateNotFound error in dashboard route: {e}", exc_info=True); return "Erreur critique: Le template du tableau de bord est introuvable.", 500
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"DB error loading initial dashboard data: {e}", exc_info=True); flash("Erreur de base de données lors du chargement initial du tableau de bord.", "danger"); return render_template('error.html', error_message="Impossible de charger les données initiales du tableau de bord.")
    except Exception as e: db.session.rollback(); app.logger.error(f"Unexpected error in dashboard route (initial data): {e}", exc_info=True); flash("Une erreur interne est survenue.", "danger"); return render_template('error.html', error_message="Erreur interne du serveur lors du chargement du tableau de bord.")

@app.route('/services') # From updated_app.py
@login_required 
@db_operation_with_retry(max_retries=3)
def services(): 
    app.logger.info(f"User '{current_user.username if current_user.is_authenticated else 'Anonymous'}' accessing /services page.")
    try:
        all_services_db = Service.query.options(selectinload(Service.participants).selectinload(Participant.inscriptions)).order_by(Service.nom).all()
        services_data_for_template = []
        for service_obj in all_services_db:
            participants_detailed_list = []
            for participant in service_obj.participants:
                confirmed_count = sum(1 for insc in participant.inscriptions if insc.statut == 'confirmé')
                participants_detailed_list.append({'obj': participant, 'confirmed_count': confirmed_count})
            participants_detailed_list.sort(key=lambda p: (p['obj'].nom.lower(), p['obj'].prenom.lower()))
            services_data_for_template.append({'obj': service_obj, 'participant_count': len(service_obj.participants), 'participants_detailed': participants_detailed_list})
        return render_template('services.html', services_data=services_data_for_template)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"DB error loading services page: {e}", exc_info=True); flash("Erreur de base de données lors du chargement des services.", "danger"); return redirect(url_for('dashboard'))
    except Exception as e: db.session.rollback(); app.logger.error(f"Unexpected error loading services page: {e}", exc_info=True); flash("Une erreur interne est survenue.", "danger"); return redirect(url_for('dashboard'))

@app.route('/sessions') # From original_app.py
@db_operation_with_retry(max_retries=3)
def sessions():
    app.logger.info(f"User '{current_user.username if current_user.is_authenticated else 'Anonymous'}' accessing /sessions.")
    try:
        query = Session.query.options(selectinload(Session.theme), selectinload(Session.salle), selectinload(Session.inscriptions).selectinload(Inscription.participant).selectinload(Participant.service), selectinload(Session.liste_attente).selectinload(ListeAttente.participant).selectinload(Participant.service)).order_by(Session.date, Session.heure_debut)
        theme_id_filter = request.args.get('theme'); date_str_filter = request.args.get('date'); places_filter = request.args.get('places')
        if theme_id_filter:
            try: query = query.filter(Session.theme_id == int(theme_id_filter))
            except ValueError: flash('ID de thème invalide.', 'warning')
        if date_str_filter:
            try: date_obj = date.fromisoformat(date_str_filter); query = query.filter(Session.date >= date_obj)
            except ValueError: flash('Format de date invalide (AAAA-MM-JJ).', 'warning')
        all_sessions_from_db = query.all(); app.logger.info(f"Fetched {len(all_sessions_from_db)} sessions from DB after base filters.")
        sessions_final_data = []
        for s_obj in all_sessions_from_db:
            inscrits_confirmes_list = [i for i in s_obj.inscriptions if i.statut == 'confirmé']; pending_inscriptions_list = [i for i in s_obj.inscriptions if i.statut == 'en attente']; liste_attente_entries_list = s_obj.liste_attente
            inscrits_count = len(inscrits_confirmes_list); attente_count = len(liste_attente_entries_list); pending_count = len(pending_inscriptions_list)
            places_rest = max(0, (s_obj.max_participants or 0) - inscrits_count)
            if places_filter == 'available' and places_rest <= 0: continue
            if places_filter == 'full' and places_rest > 0: continue
            sessions_final_data.append({'obj': s_obj, 'places_restantes': places_rest, 'inscrits_confirmes_count': inscrits_count, 'liste_attente_count': attente_count, 'pending_count': pending_count, 'loaded_inscrits_confirmes': sorted(inscrits_confirmes_list, key=lambda i: i.date_inscription, reverse=True), 'loaded_pending_inscriptions': sorted(pending_inscriptions_list, key=lambda i: i.date_inscription, reverse=True), 'loaded_liste_attente': sorted(liste_attente_entries_list, key=lambda la: la.position)})
        app.logger.info(f"Prepared {len(sessions_final_data)} sessions for template after all filters.")
        themes_for_filter = get_all_themes(); participants_for_modal = get_all_participants_with_service(); services_for_modal = get_all_services_with_participants(); salles_for_modal = []
        if current_user.is_authenticated and current_user.role == 'admin': salles_for_modal = get_all_salles()
        return render_template('sessions.html', sessions_data=sessions_final_data, themes=themes_for_filter, participants=participants_for_modal, services=services_for_modal, salles=salles_for_modal, request_args=request.args, Inscription=Inscription, ListeAttente=ListeAttente)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"DB error in /sessions route: {e}", exc_info=True); flash("Erreur de base de données lors du chargement des sessions.", "danger"); return redirect(url_for('dashboard'))
    except Exception as e: db.session.rollback(); app.logger.error(f"Unexpected error in /sessions route: {e}", exc_info=True); flash("Une erreur interne est survenue lors du chargement des sessions.", "danger"); return redirect(url_for('dashboard'))

@app.route('/inscription', methods=['POST']) # From original_app.py
@db_operation_with_retry(max_retries=3)
def inscription():
    from_page_value = request.form.get('from_page', 'dashboard'); valid_from_pages = ['admin', 'services', 'participants', 'sessions', 'dashboard']; redirect_url = url_for(from_page_value) if from_page_value in valid_from_pages else url_for('dashboard')
    app.logger.info(f"--- Route /inscription POST ---"); app.logger.debug(f"Form data: {request.form}")
    try:
        participant_id_from_form = request.form.get('participant_id', type=int); session_id_from_form = request.form.get('session_id', type=int)
        app.logger.info(f"Inscription attempt: P_ID={participant_id_from_form}, S_ID={session_id_from_form}")
        if not participant_id_from_form or not session_id_from_form: flash('Données d\'inscription cruciales manquantes.', 'danger'); return redirect(redirect_url)
        participant_a_inscrire = db.session.get(Participant, participant_id_from_form); session_obj = db.session.get(Session, session_id_from_form)
        if not participant_a_inscrire: flash(f'Participant introuvable.', 'danger'); return redirect(redirect_url)
        if not session_obj: flash(f'Session introuvable.', 'danger'); return redirect(redirect_url)
        app.logger.info(f"Processing for P: {participant_a_inscrire.prenom} {participant_a_inscrire.nom} (ID:{participant_a_inscrire.id}) to S: {session_obj.theme.nom} (ID:{session_obj.id})")
        existing_active_inscription = Inscription.query.filter(Inscription.participant_id == participant_a_inscrire.id, Inscription.session_id == session_obj.id, Inscription.statut.in_(['confirmé', 'en attente'])).first()
        if existing_active_inscription: flash(f'{participant_a_inscrire.prenom} {participant_a_inscrire.nom} a déjà une inscription "{existing_active_inscription.statut}" pour cette session.', 'warning'); return redirect(redirect_url)
        existing_waitlist = ListeAttente.query.filter_by(participant_id=participant_a_inscrire.id, session_id=session_obj.id).first()
        if existing_waitlist: flash(f'{participant_a_inscrire.prenom} {participant_a_inscrire.nom} est déjà en liste d\'attente (position {existing_waitlist.position}) pour cette session.', 'warning'); return redirect(redirect_url)
        existing_inactive_inscription = Inscription.query.filter(Inscription.participant_id == participant_a_inscrire.id, Inscription.session_id == session_obj.id, Inscription.statut.in_(['refusé', 'annulé'])).first()
        current_confirmed_for_session = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == session_obj.id, Inscription.statut == 'confirmé').scalar() or 0
        places_disponibles = session_obj.get_places_restantes(confirmed_count=current_confirmed_for_session)
        app.logger.debug(f"S_ID={session_obj.id}: Places disponibles calculées = {places_disponibles} (Confirmés actuels: {current_confirmed_for_session})")
        if places_disponibles <= 0: app.logger.info(f"Session S_ID={session_obj.id} complète. Redirection vers liste d'attente pour P_ID={participant_a_inscrire.id}."); flash(f'La session "{session_obj.theme.nom}" est complète. Une inscription en liste d\'attente est nécessaire.', 'info'); return redirect(url_for('liste_attente', session_id=session_obj.id, participant_id=participant_a_inscrire.id, from_page=from_page_value))
        if existing_inactive_inscription:
            app.logger.info(f"Réactivation de l'inscription inactive (statut: {existing_inactive_inscription.statut}) pour P_ID={participant_a_inscrire.id} à S_ID={session_obj.id}.")
            existing_inactive_inscription.statut = 'en attente'; existing_inactive_inscription.date_inscription = datetime.now(UTC); existing_inactive_inscription.validation_responsable = False
            db.session.add(existing_inactive_inscription); flash_message = f'Votre précédente inscription ({existing_inactive_inscription.statut}) pour "{participant_a_inscrire.prenom} {participant_a_inscrire.nom}" à la session "{session_obj.theme.nom}" a été réactivée et est maintenant en attente de validation.'; activity_type = 'reinscription'; activity_desc = f'Réactivation inscription: {participant_a_inscrire.prenom} {participant_a_inscrire.nom}'
        else:
            app.logger.info(f"Création d'une nouvelle inscription 'en attente' pour P_ID={participant_a_inscrire.id} à S_ID={session_obj.id}.")
            new_inscription = Inscription(participant_id=participant_a_inscrire.id, session_id=session_obj.id, statut='en attente')
            db.session.add(new_inscription); flash_message = f'Votre demande d\'inscription pour "{participant_a_inscrire.prenom} {participant_a_inscrire.nom}" à la session "{session_obj.theme.nom}" a été enregistrée et est en attente de validation.'; activity_type = 'inscription'; activity_desc = f'Demande inscription: {participant_a_inscrire.prenom} {participant_a_inscrire.nom}'
        db.session.commit(); cache.delete(f'session_counts_{session_obj.id}'); app.logger.info(f"Cache invalidé pour session_counts_{session_obj.id} (inscription/réactivation).")
        add_activity(activity_type, activity_desc, f'Session: {session_obj.theme.nom} ({session_obj.formatage_date})', user=current_user if current_user.is_authenticated else None)
        socketio.emit('inscription_nouvelle', {'session_id': session_obj.id, 'participant_id': participant_a_inscrire.id, 'statut': 'en attente'}, room='general')
        flash(flash_message, 'success')
    except IntegrityError as ie: db.session.rollback(); flash('Erreur d\'intégrité : Impossible de traiter votre demande. Conflit de données possible.', 'danger'); app.logger.error(f"Inscription: IntegrityError - {ie}", exc_info=True)
    except SQLAlchemyError as e: db.session.rollback(); flash('Erreur de base de données lors de la tentative d\'inscription.', 'danger'); app.logger.error(f"Inscription: SQLAlchemyError - {e}", exc_info=True)
    except Exception as e: db.session.rollback(); flash('Une erreur inattendue est survenue lors de la tentative d\'inscription.', 'danger'); app.logger.error(f"Inscription: Unexpected Error - {e}", exc_info=True)
    return redirect(redirect_url)

@app.route('/liste_attente', methods=['GET', 'POST']) # From original_app.py
@db_operation_with_retry(max_retries=3)
def liste_attente():
    participant_id = request.args.get('participant_id', type=int) or request.form.get('participant_id', type=int); session_id = request.args.get('session_id', type=int) or request.form.get('session_id', type=int); redirect_url = request.referrer or url_for('dashboard')
    if not participant_id or not session_id: flash('Informations participant/session manquantes.', 'danger'); return redirect(redirect_url)
    try:
        participant = db.session.get(Participant, participant_id); session_obj = db.session.get(Session, session_id)
        if not participant or not session_obj: flash('Participant ou session introuvable.', 'danger'); return redirect(redirect_url)
        if (ListeAttente.query.filter_by(participant_id=participant_id, session_id=session_id).first() or Inscription.query.filter_by(participant_id=participant_id, session_id=session_id, statut__in=['confirmé', 'en attente']).first()): flash(f"{participant.prenom} {participant.nom} est déjà inscrit(e) ou en liste d'attente.", 'warning'); return redirect(redirect_url) # Corrected statut check
        if session_obj.get_places_restantes() > 0: flash(f"Bonne nouvelle ! Il reste {session_obj.get_places_restantes()} place(s) pour cette session. Vous pouvez vous inscrire directement.", 'info'); return redirect(url_for('sessions')) # Corrected redirect
        if request.method == 'POST':
            position = db.session.query(func.count(ListeAttente.id)).filter(ListeAttente.session_id == session_id).scalar() + 1
            attente = ListeAttente(participant_id=participant_id, session_id=session_id, position=position); db.session.add(attente); db.session.commit(); cache.delete(f'session_counts_{session_id}')
            add_activity('liste_attente', f'Ajout liste attente: {participant.prenom} {participant.nom}', f'Session: {session_obj.theme.nom} ({session_obj.formatage_date}) - Position: {position}', user=current_user)
            socketio.emit('liste_attente_nouvelle', {'session_id': session_id, 'participant_id': participant.id, 'position': position, 'total_session_attente': position}, room='general')
            flash(f'Vous avez été ajouté(e) à la liste d\'attente en position {position}.', 'success'); return redirect(url_for('dashboard'))
    except IntegrityError: db.session.rollback(); flash('Erreur: Vous êtes déjà en liste d\'attente pour cette session.', 'danger')
    except SQLAlchemyError as e: db.session.rollback(); flash('Erreur de base de données lors de l\'ajout à la liste d\'attente.', 'danger'); app.logger.error(f"SQLAlchemyError during waitlist add: {e}", exc_info=True)
    except Exception as e: db.session.rollback(); flash('Une erreur inattendue est survenue.', 'danger'); app.logger.error(f"Unexpected error during waitlist add: {e}", exc_info=True)
    if request.method == 'GET': return render_template('liste_attente.html', participant=participant, session=session_obj)
    else: return redirect(redirect_url)

@app.route('/validation_inscription/<int:inscription_id>', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=3)
def validation_inscription(inscription_id):
    redirect_url = request.referrer or url_for('dashboard')
    app.logger.info(f"Tentative de modification de l'inscription ID: {inscription_id} par l'utilisateur '{current_user.username}'. Action: {request.form.get('action')}")
    try:
        inscription = db.session.query(Inscription).options(joinedload(Inscription.participant).joinedload(Participant.service), joinedload(Inscription.session).joinedload(Session.theme)).get(inscription_id)
        if not inscription: flash('Inscription introuvable.', 'danger'); app.logger.warning(f"Inscription ID {inscription_id} non trouvée."); return redirect(redirect_url)
        is_admin = current_user.role == 'admin'
        is_responsable_du_service = (current_user.role == 'responsable' and inscription.participant and inscription.participant.service and current_user.service_id == inscription.participant.service_id)
        if not (is_admin or is_responsable_du_service): flash('Action non autorisée.', 'danger'); app.logger.warning(f"User '{current_user.username}' non autorisé pour ID {inscription_id}."); return redirect(redirect_url)
        action = request.form.get('action')
        participant_name = f"{inscription.participant.prenom} {inscription.participant.nom}" if inscription.participant else "Inconnu"
        session_info = f"Session: {inscription.session.theme.nom} ({inscription.session.formatage_date})" if inscription.session and inscription.session.theme else "Session inconnue"
        session_id_for_cache = inscription.session_id
        if action == 'valider' and inscription.statut == 'en attente':
            if inscription.session.get_places_restantes() <= 0: flash(f"Impossible de valider {participant_name} : session '{inscription.session.theme.nom}' complète.", "warning"); app.logger.info(f"Tentative validation session complète S_ID:{session_id_for_cache}."); return redirect(redirect_url)
            inscription.statut = 'confirmé'; inscription.validation_responsable = True; db.session.commit()
            cache.delete(f'session_counts_{session_id_for_cache}'); cache.delete('dashboard_essential_data_v3.2')
            add_activity('validation', f'Validation inscription: {participant_name}', session_info, user=current_user)
            flash(f'Inscription de {participant_name} validée.', 'success')
            socketio.emit('inscription_validee', {'inscription_id': inscription.id, 'session_id': session_id_for_cache, 'participant_id': inscription.participant_id, 'new_status': 'confirmé'}, room='general')
        elif action == 'refuser' and inscription.statut == 'en attente':
            inscription.statut = 'refusé'; db.session.commit(); cache.delete('dashboard_essential_data_v3.2')
            add_activity('refus', f'Refus inscription: {participant_name}', session_info, user=current_user)
            flash(f'Inscription de {participant_name} refusée.', 'warning')
            socketio.emit('inscription_refusee', {'inscription_id': inscription.id, 'session_id': session_id_for_cache, 'participant_id': inscription.participant_id, 'new_status': 'refusé'}, room='general')
        elif action == 'annuler' and inscription.statut == 'confirmé':
            inscription.statut = 'annulé'; db.session.commit()
            cache.delete(f'session_counts_{session_id_for_cache}'); cache.delete('dashboard_essential_data_v3.2')
            add_activity('annulation', f'Annulation inscription: {participant_name}', session_info, user=current_user)
            flash(f'Inscription de {participant_name} annulée.', 'success')
            check_waitlist(session_id_for_cache)
            socketio.emit('inscription_annulee', {'inscription_id': inscription.id, 'session_id': session_id_for_cache, 'participant_id': inscription.participant_id, 'new_status': 'annulé'}, room='general')
        else: flash(f"Action '{action}' invalide ou statut incorrect.", 'warning'); app.logger.warning(f"Action invalide '{action}' ou statut '{inscription.statut}' pour ID {inscription_id}.")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB modif inscription ID {inscription_id}: {e}", exc_info=True); flash('Erreur DB.', 'danger')
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue modif inscription ID {inscription_id}: {e}", exc_info=True); flash('Erreur inattendue.', 'danger')
    return redirect(redirect_url)
    
@app.route('/validation_inscription_ajax', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def validation_inscription_ajax():
    try:
        data = request.get_json(); inscription_id = data.get('inscription_id'); action = data.get('action')
        if not inscription_id or not action: app.logger.warning("Validation AJAX: données manquantes."); return jsonify({'success': False, 'message': 'Données manquantes.'}), 400
        inscription = db.session.get(Inscription, int(inscription_id))
        if not inscription: app.logger.warning(f"Validation AJAX: Inscription {inscription_id} introuvable."); return jsonify({'success': False, 'message': 'Inscription introuvable.'}), 404
        participant = inscription.participant; session_obj = inscription.session
        is_admin = current_user.role == 'admin'; is_responsable = (current_user.role == 'responsable' and participant and participant.service and current_user.service_id == participant.service_id)
        if not (is_admin or is_responsable): app.logger.warning(f"Validation AJAX: User {current_user.username} non autorisé pour inscription {inscription_id}."); return jsonify({'success': False, 'message': 'Action non autorisée.'}), 403
        original_status = inscription.statut; message = ""
        if action == 'valider' and original_status == 'en attente':
            if session_obj.get_places_restantes() <= 0: app.logger.info(f"Validation AJAX: Session {session_obj.id} complète."); return jsonify({'success': False, 'message': 'Impossible de valider : la session est complète.'})
            inscription.statut = 'confirmé'; inscription.validation_responsable = True; message = 'Inscription validée avec succès.'
            add_activity('validation', f'Validation AJAX: {participant.prenom} {participant.nom}', f'Session: {session_obj.theme.nom}', user=current_user); cache.delete(f'session_counts_{session_obj.id}'); cache.delete('dashboard_essential_data_v3.2')
            socketio.emit('inscription_validee', {'inscription_id': inscription.id, 'session_id': session_obj.id, 'participant_id': participant.id, 'new_status': 'confirmé'}, room='general')
        elif action == 'refuser' and original_status == 'en attente':
            inscription.statut = 'refusé'; message = 'Inscription refusée.'
            add_activity('refus', f'Refus AJAX: {participant.prenom} {participant.nom}', f'Session: {session_obj.theme.nom}', user=current_user); cache.delete('dashboard_essential_data_v3.2')
            socketio.emit('inscription_refusee', {'inscription_id': inscription.id, 'session_id': session_obj.id, 'participant_id': participant.id, 'new_status': 'refusé'}, room='general')
        else: app.logger.warning(f"Validation AJAX: Action '{action}' invalide ou statut '{original_status}' incorrect."); return jsonify({'success': False, 'message': f"Action '{action}' invalide ou statut incorrect."})
        db.session.commit(); app.logger.info(f"Validation AJAX: {message} pour inscription {inscription_id} par user {current_user.username}.")
        return jsonify({'success': True, 'message': message, 'new_status': inscription.statut})
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Validation AJAX: Erreur DB - {e}", exc_info=True); return jsonify({'success': False, 'message': 'Erreur de base de données.'}), 500
    except Exception as e: db.session.rollback(); app.logger.error(f"Validation AJAX: Erreur inattendue - {e}", exc_info=True); return jsonify({'success': False, 'message': 'Erreur interne du serveur.'}), 500

@app.route('/documents') # From original_app.py (includes general_documents)
@db_operation_with_retry(max_retries=3)
def documents():
    try:
        app.logger.info(f"Accès page /documents par '{current_user.username if current_user.is_authenticated else 'Anonymous'}'")
        themes_with_docs = Theme.query.options(selectinload(Theme.documents).joinedload(Document.uploader)).order_by(Theme.nom).all()
        general_documents = Document.query.filter(Document.theme_id == None).options(joinedload(Document.uploader)).order_by(Document.upload_date.desc()).all()
        themes_for_upload_dropdown = []
        if current_user.is_authenticated and current_user.role == 'admin':
            themes_for_upload_dropdown = Theme.query.order_by(Theme.nom).all()
        return render_template('documents.html', themes_with_docs=themes_with_docs, general_documents=general_documents, themes=themes_for_upload_dropdown, ALLOWED_EXTENSIONS=ALLOWED_EXTENSIONS)
    except SQLAlchemyError as e:
        db.session.rollback(); app.logger.error(f"DB error loading documents page: {e}", exc_info=True); flash("Erreur de base de données lors du chargement des documents.", "danger"); return redirect(url_for('dashboard')) 
    except Exception as e:
        db.session.rollback(); app.logger.error(f"Unexpected error loading documents page: {e}", exc_info=True); flash("Une erreur interne est survenue.", "danger"); return redirect(url_for('dashboard'))

@app.route('/download_document/<path:filename>') # From original_app.py
@db_operation_with_retry(max_retries=2)
def download_document(filename):
    try:
        safe_filename = secure_filename(filename)
        if safe_filename != filename: app.logger.warning(f"Tentative de téléchargement avec nom de fichier potentiellement dangereux: {filename}"); flash("Nom de fichier invalide.", "danger"); return redirect(url_for('documents'))
        doc = Document.query.filter_by(filename=safe_filename).first()
        if not doc: app.logger.warning(f"Tentative de téléchargement d'un document inexistant: {safe_filename}"); flash("Document non trouvé.", "danger"); return redirect(url_for('documents'))
        app.logger.info(f"Téléchargement du document '{doc.original_filename}' (fichier: {safe_filename}) demandé.")
        upload_dir = app.config['UPLOAD_FOLDER']
        if not os.path.isabs(upload_dir): upload_dir = os.path.join(app.root_path, upload_dir)
        return send_from_directory(upload_dir, safe_filename, as_attachment=True, download_name=doc.original_filename)
    except FileNotFoundError: app.logger.error(f"Fichier non trouvé sur le disque pour le document: {safe_filename}", exc_info=True); flash("Erreur : le fichier demandé n'existe plus sur le serveur.", "danger"); return redirect(url_for('documents'))
    except Exception as e: app.logger.error(f"Erreur lors du téléchargement du document {safe_filename}: {e}", exc_info=True); flash("Erreur lors du téléchargement du document.", "danger"); return redirect(url_for('documents'))

@app.route('/salles') # From original_app.py (salles_page)
@login_required
@db_operation_with_retry(max_retries=3)
def salles_page():
    if current_user.role != 'admin': flash("Accès réservé aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    app.logger.info(f"Admin '{current_user.username}' accède à la page /salles.")
    try:
        salles_list = Salle.query.order_by(Salle.nom).all()
        salles_data_for_template = []
        salle_ids = [s.id for s in salles_list]
        session_counts = {}
        if salle_ids:
             counts_q = db.session.query(Session.salle_id, func.count(Session.id)).filter(Session.salle_id.in_(salle_ids)).group_by(Session.salle_id).all()
             session_counts = dict(counts_q)
        for s in salles_list:
             salles_data_for_template.append({'obj': s, 'sessions_count': session_counts.get(s.id, 0), 'sessions_associees': [] })
        return render_template('salles.html', salles_data=salles_data_for_template)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB chargement page salles: {e}", exc_info=True); flash("Erreur de base de données lors du chargement des salles.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue chargement page salles: {e}", exc_info=True); flash("Une erreur interne est survenue lors du chargement des salles.", "danger")
    return redirect(url_for('admin'))

@app.route('/salle/add', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def add_salle():
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    nom = request.form.get('nom'); capacite_str = request.form.get('capacite'); lieu = request.form.get('lieu'); description = request.form.get('description')
    if not nom or not capacite_str: flash("Le nom et la capacité de la salle sont obligatoires.", "warning"); return redirect(url_for('salles_page'))
    try:
        capacite = int(capacite_str)
        if capacite <= 0: flash("La capacité doit être un nombre positif.", "warning"); return redirect(url_for('salles_page'))
        existing_salle = Salle.query.filter(func.lower(Salle.nom) == func.lower(nom)).first()
        if existing_salle: flash(f"Une salle nommée '{nom}' existe déjà.", "warning"); return redirect(url_for('salles_page'))
        new_salle = Salle(nom=nom, capacite=capacite, lieu=lieu, description=description)
        db.session.add(new_salle); db.session.commit()
        cache.delete_memoized(get_all_salles); cache.delete('dashboard_essential_data_v3.2')
        add_activity('ajout_salle', f'Ajout salle: {new_salle.nom}', f'Capacité: {new_salle.capacite}', user=current_user)
        flash(f"Salle '{new_salle.nom}' ajoutée avec succès.", "success")
    except ValueError: flash("La capacité doit être un nombre valide.", "warning")
    except IntegrityError: db.session.rollback(); flash(f"Erreur : Une salle nommée '{nom}' existe probablement déjà.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB ajout salle: {e}", exc_info=True); flash("Erreur de base de données.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue ajout salle: {e}", exc_info=True); flash("Une erreur inattendue.", "danger")
    return redirect(url_for('salles_page'))

@app.route('/salle/update/<int:id>', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def update_salle(id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    salle = db.session.get(Salle, id)
    if not salle: flash("Salle introuvable.", "warning"); return redirect(url_for('salles_page'))
    nom = request.form.get('nom'); capacite_str = request.form.get('capacite'); lieu = request.form.get('lieu'); description = request.form.get('description')
    if not nom or not capacite_str: flash("Le nom et la capacité sont obligatoires.", "warning"); return redirect(url_for('salles_page'))
    try:
        capacite = int(capacite_str)
        if capacite <= 0: flash("La capacité doit être un nombre positif.", "warning"); return redirect(url_for('salles_page'))
        if nom.lower() != salle.nom.lower():
            existing_salle = Salle.query.filter(func.lower(Salle.nom) == func.lower(nom), Salle.id != id).first()
            if existing_salle: flash(f"Une autre salle nommée '{nom}' existe déjà.", "warning"); return redirect(url_for('salles_page'))
        salle.nom = nom; salle.capacite = capacite; salle.lieu = lieu; salle.description = description
        db.session.commit(); cache.delete_memoized(get_all_salles); cache.delete('dashboard_essential_data_v3.2')
        add_activity('modification_salle', f'Modif salle: {salle.nom}', user=current_user)
        flash(f"Salle '{salle.nom}' mise à jour.", "success")
    except ValueError: flash("La capacité doit être un nombre valide.", "warning")
    except IntegrityError: db.session.rollback(); flash(f"Erreur : Le nom '{nom}' est peut-être déjà utilisé.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB màj salle {id}: {e}", exc_info=True); flash("Erreur DB.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue màj salle {id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('salles_page'))

@app.route('/salle/delete/<int:id>', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def delete_salle(id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    salle = db.session.get(Salle, id)
    if not salle: flash("Salle introuvable.", "warning"); return redirect(url_for('salles_page'))
    session_count = Session.query.filter_by(salle_id=id).count()
    if session_count > 0: flash(f"Impossible de supprimer '{salle.nom}', {session_count} session(s) y sont associées.", "danger"); return redirect(url_for('salles_page'))
    try:
        salle_nom = salle.nom; db.session.delete(salle); db.session.commit()
        cache.delete_memoized(get_all_salles); cache.delete('dashboard_essential_data_v3.2')
        add_activity('suppression_salle', f'Suppression salle: {salle_nom}', user=current_user)
        flash(f"Salle '{salle_nom}' supprimée.", "success")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB suppression salle {id}: {e}", exc_info=True); flash("Erreur DB.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue suppression salle {id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('salles_page'))

@app.route('/attribuer_salle', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def attribuer_salle():
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    session_id_str = request.form.get('session_id'); salle_id_str = request.form.get('salle_id'); redirect_url = request.referrer or url_for('sessions')
    if not session_id_str: flash("ID de session manquant.", "warning"); return redirect(redirect_url)
    try:
        session_id = int(session_id_str); session = db.session.get(Session, session_id)
        if not session: flash("Session introuvable.", "warning"); return redirect(redirect_url)
        salle_id = None; salle_nom = "Aucune"
        if salle_id_str:
            salle_id = int(salle_id_str); salle = db.session.get(Salle, salle_id)
            if not salle: flash("Salle sélectionnée introuvable.", "warning"); return redirect(redirect_url)
            salle_nom = salle.nom
        session.salle_id = salle_id; db.session.commit()
        cache.delete(f'session_details_{session_id}'); cache.delete('dashboard_essential_data_v3.2')
        add_activity('attribution_salle', f'Salle attribuée: {salle_nom}', f'Session: {session.theme.nom} ({session.formatage_date})', user=current_user)
        flash(f"Salle '{salle_nom}' attribuée à '{session.theme.nom}' du {session.formatage_date}.", "success")
    except ValueError: flash("ID de session ou de salle invalide.", "warning")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB attribution salle: {e}", exc_info=True); flash("Erreur DB.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue attribution salle: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(redirect_url)

@app.route('/themes') # From original_app.py (themes_page)
@login_required
@db_operation_with_retry(max_retries=3)
def themes_page():
    if current_user.role != 'admin': flash("Accès réservé aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    app.logger.info(f"Admin '{current_user.username}' accède à la page /themes.")
    try:
        themes_list = Theme.query.options(selectinload(Theme.sessions)).order_by(Theme.nom).all()
        themes_data_for_template = []
        session_ids = [s.id for theme in themes_list for s in theme.sessions]
        confirmed_counts = {}
        if session_ids:
             counts_q = db.session.query(Inscription.session_id, func.count(Inscription.id)).filter(Inscription.session_id.in_(session_ids), Inscription.statut == 'confirmé').group_by(Inscription.session_id).all()
             confirmed_counts = dict(counts_q)
        for theme in themes_list:
            total_sessions_for_theme = len(theme.sessions); sessions_detailed = []
            for session_obj in sorted(theme.sessions, key=lambda s: s.date): # Renamed session to session_obj
                 confirmed_count = confirmed_counts.get(session_obj.id, 0)
                 places_restantes = max(0, (session_obj.max_participants or 0) - confirmed_count)
                 sessions_detailed.append({'obj': session_obj, 'confirmed_count': confirmed_count, 'places_restantes': places_restantes})
            themes_data_for_template.append({'obj': theme, 'total_sessions': total_sessions_for_theme, 'sessions_detailed': sessions_detailed})
        csrf_token_field = None # Replace with actual CSRF field if needed (e.g. from flask_wtf.csrf import generate_csrf)
        return render_template('themes.html', themes_data=themes_data_for_template, csrf_token_field=csrf_token_field)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB chargement page thèmes: {e}", exc_info=True); flash("Erreur DB.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue chargement page thèmes: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('admin'))

@app.route('/theme/add', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def add_theme():
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    nom = request.form.get('nom'); description = request.form.get('description')
    if not nom: flash("Le nom du thème est obligatoire.", "warning"); return redirect(url_for('themes_page'))
    try:
        existing_theme = Theme.query.filter(func.lower(Theme.nom) == func.lower(nom)).first()
        if existing_theme: flash(f"Un thème nommé '{nom}' existe déjà.", "warning"); return redirect(url_for('themes_page'))
        new_theme = Theme(nom=nom, description=description)
        db.session.add(new_theme); db.session.commit()
        cache.delete_memoized(get_all_themes); cache.delete('dashboard_essential_data_v3.2')
        add_activity('ajout_theme', f'Ajout thème: {new_theme.nom}', user=current_user)
        flash(f"Thème '{new_theme.nom}' ajouté.", "success")
    except IntegrityError: db.session.rollback(); flash(f"Erreur : Un thème nommé '{nom}' existe probablement déjà.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB ajout thème: {e}", exc_info=True); flash("Erreur DB.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue ajout thème: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('themes_page'))

@app.route('/theme/update/<int:id>', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def update_theme(id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    theme = db.session.get(Theme, id)
    if not theme: flash("Thème introuvable.", "warning"); return redirect(url_for('themes_page'))
    nom = request.form.get('nom'); description = request.form.get('description')
    if not nom: flash("Le nom du thème est obligatoire.", "warning"); return redirect(url_for('themes_page'))
    try:
        if nom.lower() != theme.nom.lower():
            existing_theme = Theme.query.filter(func.lower(Theme.nom) == func.lower(nom), Theme.id != id).first()
            if existing_theme: flash(f"Un autre thème nommé '{nom}' existe déjà.", "warning"); return redirect(url_for('themes_page'))
        theme.nom = nom; theme.description = description
        db.session.commit(); cache.delete_memoized(get_all_themes); cache.delete('dashboard_essential_data_v3.2')
        add_activity('modification_theme', f'Modif thème: {theme.nom}', user=current_user)
        flash(f"Thème '{theme.nom}' mis à jour.", "success")
    except IntegrityError: db.session.rollback(); flash(f"Erreur : Le nom '{nom}' est peut-être déjà utilisé.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB màj thème {id}: {e}", exc_info=True); flash("Erreur DB.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue màj thème {id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('themes_page'))

@app.route('/theme/delete/<int:id>', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def delete_theme(id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    theme = db.session.get(Theme, id)
    if not theme: flash("Thème introuvable.", "warning"); return redirect(url_for('themes_page'))
    try:
        theme_nom = theme.nom
        # Cascade for documents is handled by model. Sessions need manual handling if not cascaded.
        # Original code had manual deletion logic for sessions, inscriptions, liste_attente.
        # Theme model in updated_app.py has lazy='selectin' for sessions, no cascade.
        # Document model has cascade="all, delete-orphan".
        sessions_associees = Session.query.filter_by(theme_id=id).all()
        if sessions_associees:
             session_ids = [s.id for s in sessions_associees]
             Inscription.query.filter(Inscription.session_id.in_(session_ids)).delete(synchronize_session=False)
             ListeAttente.query.filter(ListeAttente.session_id.in_(session_ids)).delete(synchronize_session=False)
             Session.query.filter_by(theme_id=id).delete(synchronize_session=False)
             app.logger.info(f"Suppression manuelle de {len(sessions_associees)} sessions et dépendances pour thème ID {id}.")
        db.session.delete(theme); db.session.commit()
        cache.delete_memoized(get_all_themes); cache.delete('dashboard_essential_data_v3.2')
        add_activity('suppression_theme', f'Suppression thème: {theme_nom}', user=current_user)
        flash(f"Thème '{theme_nom}' et ses sessions/documents associés supprimés.", "success")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB suppression thème {id}: {e}", exc_info=True); flash("Erreur DB.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue suppression thème {id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('themes_page'))

@app.route('/service/add', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def add_service():
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    service_id = request.form.get('id'); nom = request.form.get('nom'); couleur = request.form.get('couleur', '#6c757d'); responsable = request.form.get('responsable'); email_responsable = request.form.get('email_responsable')
    if not all([service_id, nom, responsable, email_responsable]): flash("Champs ID, Nom, Responsable, Email obligatoires.", "warning"); return redirect(url_for('services'))
    existing_by_id = Service.query.filter(func.lower(Service.id) == func.lower(service_id)).first()
    existing_by_name = Service.query.filter(func.lower(Service.nom) == func.lower(nom)).first()
    if existing_by_id: flash(f"Service avec ID '{service_id}' existe déjà.", "warning"); return redirect(url_for('services'))
    if existing_by_name: flash(f"Service nommé '{nom}' existe déjà.", "warning"); return redirect(url_for('services'))
    try:
        new_service = Service(id=service_id.lower(), nom=nom, couleur=couleur, responsable=responsable, email_responsable=email_responsable)
        db.session.add(new_service); db.session.commit()
        cache.delete_memoized(get_all_services_with_participants); cache.delete('dashboard_essential_data_v3.2')
        add_activity('ajout_service', f'Ajout service: {new_service.nom}', f'ID: {new_service.id}', user=current_user)
        flash(f"Service '{new_service.nom}' ajouté.", "success")
    except IntegrityError: db.session.rollback(); flash(f"Erreur : ID '{service_id}' ou nom '{nom}' existe déjà.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB ajout service: {e}", exc_info=True); flash("Erreur DB.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue ajout service: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('services'))

@app.route('/service/update/<string:service_id>', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def update_service(service_id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    service = db.session.get(Service, service_id)
    if not service: flash("Service introuvable.", "warning"); return redirect(url_for('services'))
    nom = request.form.get('nom'); couleur = request.form.get('couleur', '#6c757d'); responsable = request.form.get('responsable'); email_responsable = request.form.get('email_responsable')
    if not all([nom, responsable, email_responsable]): flash("Champs Nom, Responsable, Email obligatoires.", "warning"); return redirect(url_for('services'))
    try:
        if nom.lower() != service.nom.lower():
            existing_service = Service.query.filter(func.lower(Service.nom) == func.lower(nom), Service.id != service_id).first()
            if existing_service: flash(f"Un autre service nommé '{nom}' existe déjà.", "warning"); return redirect(url_for('services'))
        service.nom = nom; service.couleur = couleur; service.responsable = responsable; service.email_responsable = email_responsable
        db.session.commit(); cache.delete_memoized(get_all_services_with_participants); cache.delete('dashboard_essential_data_v3.2')
        add_activity('modification_service', f'Modif service: {service.nom}', user=current_user)
        flash(f"Service '{service.nom}' mis à jour.", "success")
    except IntegrityError: db.session.rollback(); flash(f"Erreur : Nom '{nom}' déjà utilisé.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB màj service {service_id}: {e}", exc_info=True); flash("Erreur DB.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue màj service {service_id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('services'))

@app.route('/participants') # From original_app.py (participants_page)
@db_operation_with_retry(max_retries=3)
def participants_page():
    app.logger.info(f"Utilisateur '{current_user.username if current_user.is_authenticated else 'Anonymous'}' accède à /participants.")
    try:
        participants_list = Participant.query.options(joinedload(Participant.service)).order_by(Participant.nom, Participant.prenom).all()
        services_for_modal = Service.query.order_by(Service.nom).all()
        participant_ids = [p.id for p in participants_list]; confirmed_counts = {}; waitlist_counts = {}; pending_counts = {}
        if participant_ids:
            confirmed_q = db.session.query(Inscription.participant_id, func.count(Inscription.id)).filter(Inscription.participant_id.in_(participant_ids), Inscription.statut == 'confirmé').group_by(Inscription.participant_id).all(); confirmed_counts = dict(confirmed_q)
            waitlist_q = db.session.query(ListeAttente.participant_id, func.count(ListeAttente.id)).filter(ListeAttente.participant_id.in_(participant_ids)).group_by(ListeAttente.participant_id).all(); waitlist_counts = dict(waitlist_q)
            pending_q = db.session.query(Inscription.participant_id, func.count(Inscription.id)).filter(Inscription.participant_id.in_(participant_ids), Inscription.statut == 'en attente').group_by(Inscription.participant_id).all(); pending_counts = dict(pending_q)
        participants_data_for_template = [{'obj': p, 'inscriptions_count': confirmed_counts.get(p.id, 0), 'attente_count': waitlist_counts.get(p.id, 0), 'pending_count': pending_counts.get(p.id, 0)} for p in participants_list]
        return render_template('participants.html', participants_data=participants_data_for_template, services=services_for_modal)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB chargement page participants: {e}", exc_info=True); flash("Erreur DB.", "danger"); return redirect(url_for('dashboard'))
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue chargement page participants: {e}", exc_info=True); flash("Erreur inattendue.", "danger"); return redirect(url_for('dashboard'))

@app.route('/participant/add', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def add_participant():
    if not (current_user.role == 'admin' or current_user.role == 'responsable'): flash("Action non autorisée.", "danger"); return redirect(request.referrer or url_for('dashboard'))
    nom = request.form.get('nom'); prenom = request.form.get('prenom'); email = request.form.get('email'); service_id = request.form.get('service_id'); from_page = request.form.get('from_page', 'dashboard'); redirect_session_id = request.form.get('redirect_session_id', type=int); action_after_add = request.form.get('action_after_add')
    valid_from_pages = ['dashboard', 'services', 'participants_page', 'admin']; default_redirect_url = url_for(from_page) if from_page in valid_from_pages else url_for('dashboard')
    if not all([nom, prenom, email, service_id]): flash('Champs marqués * obligatoires.', 'warning'); return redirect(default_redirect_url)
    existing_participant = Participant.query.filter(func.lower(Participant.email) == func.lower(email)).first()
    if existing_participant: flash(f'Email {email} existe déjà.', 'warning'); return redirect(default_redirect_url)
    try:
        new_participant = Participant(nom=nom, prenom=prenom, email=email, service_id=service_id)
        db.session.add(new_participant); db.session.flush(); participant_id = new_participant.id; participant_name = f"{new_participant.prenom} {new_participant.nom}"; db.session.commit()
        cache.delete_memoized(get_all_participants_with_service); cache.delete_memoized(get_all_services_with_participants); cache.delete('dashboard_essential_data_v3.2')
        add_activity('ajout_participant', f'Ajout: {participant_name}', f'Service: {new_participant.service.nom}', user=current_user)
        flash(f'Participant "{participant_name}" ajouté.', 'success')
        if action_after_add == 'inscription' and redirect_session_id:
            app.logger.info(f"Participant {participant_id} ajouté, tentative inscription session {redirect_session_id}")
            session_obj = db.session.get(Session, redirect_session_id)
            if not session_obj: flash(f'Session {redirect_session_id} introuvable pour inscription auto.', 'warning')
            else:
                existing_active = Inscription.query.filter_by(participant_id=participant_id, session_id=redirect_session_id, statut__in=['confirmé', 'en attente']).first() # Corrected statut check
                if existing_active: flash(f'{participant_name} déjà inscrit.', 'warning')
                elif session_obj.get_places_restantes() <= 0:
                     position = db.session.query(func.count(ListeAttente.id)).filter(ListeAttente.session_id == redirect_session_id).scalar() + 1
                     attente = ListeAttente(participant_id=participant_id, session_id=redirect_session_id, position=position); db.session.add(attente); db.session.commit()
                     add_activity('liste_attente', f'Ajout liste attente (auto): {participant_name}', f'Session: {session_obj.theme.nom} - Pos: {position}', user=current_user)
                     flash(f'{participant_name} ajouté et mis en liste d\'attente (pos {position}).', 'info')
                else:
                     new_inscription = Inscription(participant_id=participant_id, session_id=redirect_session_id, statut='en attente'); db.session.add(new_inscription); db.session.commit()
                     add_activity('inscription', f'Demande inscription (auto): {participant_name}', f'Session: {session_obj.theme.nom}', user=current_user)
                     flash(f'{participant_name} ajouté et inscrit (en attente) à "{session_obj.theme.nom}".', 'success')
                     socketio.emit('inscription_nouvelle', {'session_id': redirect_session_id, 'participant_id': participant_id, 'statut': 'en attente'}, room='general')
        return redirect(default_redirect_url)
    except IntegrityError as e: db.session.rollback(); app.logger.error(f"Erreur intégrité ajout participant: {e}", exc_info=True); flash('Erreur : Email existe déjà.', 'danger')
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB ajout participant: {e}", exc_info=True); flash('Erreur DB.', 'danger')
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue ajout participant: {e}", exc_info=True); flash('Erreur inattendue.', 'danger')
    return redirect(default_redirect_url)

@app.route('/participant/update/<int:id>', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def update_participant(id):
    participant = db.session.get(Participant, id)
    if not participant: flash('Participant introuvable.', 'danger'); return redirect(url_for('participants_page'))
    is_admin = current_user.role == 'admin'; is_responsable = (current_user.role == 'responsable' and current_user.service_id == participant.service_id)
    if not (is_admin or is_responsable): flash('Action non autorisée.', 'danger'); return redirect(url_for('participants_page'))
    nom = request.form.get('nom'); prenom = request.form.get('prenom'); email = request.form.get('email'); service_id = request.form.get('service_id')
    if not all([nom, prenom, email, service_id]): flash('Champs marqués * obligatoires.', 'warning'); return redirect(request.referrer or url_for('participants_page'))
    if email.lower() != participant.email.lower():
        existing = Participant.query.filter(func.lower(Participant.email) == func.lower(email), Participant.id != id).first()
        if existing: flash(f'Email {email} déjà utilisé.', 'warning'); return redirect(request.referrer or url_for('participants_page'))
    try:
        participant.nom = nom; participant.prenom = prenom; participant.email = email; participant.service_id = service_id
        db.session.commit(); cache.delete_memoized(get_all_participants_with_service); cache.delete_memoized(get_all_services_with_participants); cache.delete('dashboard_essential_data_v3.2')
        add_activity('modification_participant', f'Modif: {participant.prenom} {participant.nom}', user=current_user)
        flash('Participant mis à jour.', 'success')
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB màj participant {id}: {e}", exc_info=True); flash('Erreur DB.', 'danger')
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue màj participant {id}: {e}", exc_info=True); flash('Erreur inattendue.', 'danger')
    return redirect(url_for('participants_page'))

@app.route('/participant/delete/<int:id>', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def delete_participant(id):
    if current_user.role != 'admin': flash('Action réservée aux administrateurs.', 'danger'); app.logger.warning(f"Tentative suppression participant ID {id} par non-admin '{current_user.username}'."); return redirect(url_for('participants_page'))
    app.logger.info(f"Tentative suppression participant ID: {id} par admin '{current_user.username}'.")
    participant = db.session.get(Participant, id)
    if not participant: flash('Participant introuvable.', 'warning'); app.logger.warning(f"Participant ID {id} non trouvé."); return redirect(url_for('participants_page'))
    participant_name = f"{participant.prenom} {participant.nom}"
    try:
        # Cascade is handled by Participant model relationships (lazy='selectin', cascade="all, delete-orphan")
        db.session.delete(participant); db.session.commit()
        cache.delete_memoized(get_all_participants_with_service); cache.delete_memoized(get_all_services_with_participants); cache.delete('dashboard_essential_data_v3.2')
        if participant.service_id: cache.delete(f'service_participant_count_{participant.service_id}')
        add_activity('suppression_participant', f'Suppression: {participant_name}', f'ID: {id}, Email: {participant.email}', user=current_user)
        flash(f'Participant "{participant_name}" et ses inscriptions/attentes supprimés.', 'success')
        app.logger.info(f"Participant ID {id} ({participant_name}) supprimé par {current_user.username}.")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB suppression participant ID {id}: {e}", exc_info=True); flash('Erreur DB.', 'danger')
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue suppression participant ID {id}: {e}", exc_info=True); flash('Erreur inattendue.', 'danger')
    return redirect(url_for('participants_page'))

@app.route('/activites') # From original_app.py (activites_journal)
@login_required
@db_operation_with_retry(max_retries=3)
def activites_journal():
    app.logger.info(f"Utilisateur '{current_user.username}' accède au journal d'activités.")
    try:
        page = request.args.get('page', 1, type=int); type_filter = request.args.get('type')
        query = Activite.query.options(joinedload(Activite.utilisateur))
        if type_filter: query = query.filter(Activite.type == type_filter)
        pagination = query.order_by(Activite.date.desc()).paginate(page=page, per_page=25, error_out=False)
        return render_template('activites.html', activites=pagination)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB chargement journal activités: {e}", exc_info=True); flash("Erreur DB.", "danger"); return redirect(url_for('dashboard'))
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue chargement journal activités: {e}", exc_info=True); flash("Erreur inattendue.", "danger"); return redirect(url_for('dashboard'))

@app.route('/admin') # From original_app.py
@login_required
@db_operation_with_retry(max_retries=3)
def admin():
    if current_user.role != 'admin': flash('Accès réservé aux administrateurs.', 'danger'); return redirect(url_for('dashboard'))
    try:
        themes = Theme.query.options(selectinload(Theme.sessions)).order_by(Theme.nom).all()
        sessions = Session.query.options(joinedload(Session.theme), joinedload(Session.salle)).order_by(Session.date, Session.heure_debut).all()
        services = Service.query.options(selectinload(Service.participants)).order_by(Service.nom).all()
        participants = Participant.query.options(joinedload(Participant.service)).order_by(Participant.nom, Participant.prenom).all()
        salles = Salle.query.order_by(Salle.nom).all()
        activites_recentes = Activite.query.options(joinedload(Activite.utilisateur)).order_by(Activite.date.desc()).limit(10).all()
        total_inscriptions = db.session.query(func.count(Inscription.id)).filter(Inscription.statut == 'confirmé').scalar() or 0
        total_en_attente = db.session.query(func.count(ListeAttente.id)).scalar() or 0 # This counts entries in ListeAttente table
        total_sessions_count = db.session.query(func.count(Session.id)).scalar() or 0
        total_sessions_completes = 0
        session_ids = [s.id for s in sessions]
        if session_ids:
             subquery = db.session.query(Inscription.session_id, func.count(Inscription.id).label('confirmed_count')).filter(Inscription.session_id.in_(session_ids), Inscription.statut == 'confirmé').group_by(Inscription.session_id).subquery()
             completed_sessions_q = db.session.query(Session.id).outerjoin(subquery, Session.id == subquery.c.session_id).filter(Session.id.in_(session_ids), func.coalesce(subquery.c.confirmed_count, 0) >= Session.max_participants).count()
             total_sessions_completes = completed_sessions_q
        theme_session_counts = {theme.id: len(theme.sessions) for theme in themes}
        existing_documents = Document.query.options(joinedload(Document.theme), joinedload(Document.uploader)).order_by(Document.upload_date.desc()).all()
        return render_template('admin.html', themes=themes, theme_session_counts=theme_session_counts, sessions=sessions, services=services, participants=participants, salles=salles, total_inscriptions=total_inscriptions, total_en_attente=total_en_attente, total_sessions_completes=total_sessions_completes, total_sessions_count=total_sessions_count, activites_recentes=activites_recentes, existing_documents=existing_documents, ListeAttente=ListeAttente)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"DB error loading admin page: {e}", exc_info=True); flash("Erreur DB page admin.", "danger"); return render_template('error.html', error_message="Erreur DB page admin."), 500
    except Exception as e: db.session.rollback(); app.logger.error(f"Unexpected error loading admin page: {e}", exc_info=True); flash("Erreur interne.", "danger"); return render_template('error.html', error_message="Erreur interne page admin."), 500

@app.route('/admin/upload_document', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def upload_document():
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    redirect_url = url_for('admin')
    try:
        if 'document_file' not in request.files: flash('Aucun fichier sélectionné.', 'warning'); return redirect(redirect_url)
        file = request.files['document_file']; theme_id_str = request.form.get('theme_id'); description = request.form.get('description', '').strip()
        if file.filename == '': flash('Aucun fichier sélectionné.', 'warning'); return redirect(redirect_url)
        if file and allowed_file(file.filename):
            original_filename = file.filename; filename_base = secure_filename(original_filename)
            filename_ext = filename_base.rsplit('.', 1)[1].lower() if '.' in filename_base else ''
            unique_id = str(int(time.time())) + "_" + str(random.randint(1000, 9999))
            filename = f"{os.path.splitext(filename_base)[0]}_{unique_id}.{filename_ext}"
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path); app.logger.info(f"Fichier '{original_filename}' uploadé comme '{filename}' par {current_user.username}.")
            theme_id = int(theme_id_str) if theme_id_str else None; file_type = filename_ext
            new_doc = Document(filename=filename, original_filename=original_filename, description=description or None, theme_id=theme_id, uploader_id=current_user.id, file_type=file_type)
            db.session.add(new_doc); db.session.commit()
            add_activity('ajout_document', f'Upload: {original_filename}', f'Thème: {new_doc.theme.nom if new_doc.theme else "Général"}', user=current_user)
            flash('Document uploadé avec succès.', 'success')
        else: flash('Type de fichier non autorisé.', 'warning')
    except RequestEntityTooLarge: flash('Le fichier est trop volumineux (limite: 16MB).', 'danger')
    except SQLAlchemyError as e: db.session.rollback(); flash("Erreur base de données lors de l'upload.", "danger"); app.logger.error(f"DB error during document upload: {e}", exc_info=True)
    except Exception as e: db.session.rollback(); flash("Erreur inattendue lors de l'upload.", "danger"); app.logger.error(f"Unexpected error during document upload: {e}", exc_info=True)
    return redirect(redirect_url)

@app.route('/admin/delete_document/<int:doc_id>', methods=['POST']) # From original_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def delete_document(doc_id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    redirect_url = url_for('admin')
    try:
        doc = db.session.get(Document, doc_id)
        if not doc: flash("Document non trouvé.", "warning"); return redirect(redirect_url)
        filename = doc.filename; original_filename = doc.original_filename; file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.exists(file_path):
            try: os.remove(file_path); app.logger.info(f"Fichier physique '{filename}' supprimé.")
            except OSError as e: app.logger.error(f"Erreur suppression fichier physique {filename}: {e}", exc_info=True)
        else: app.logger.warning(f"Fichier physique '{filename}' non trouvé pour suppression (Doc ID: {doc_id}).")
        db.session.delete(doc); db.session.commit()
        add_activity('suppression_document', f'Suppression: {original_filename}', user=current_user)
        flash(f'Document "{original_filename}" supprimé avec succès.', 'success')
    except SQLAlchemyError as e: db.session.rollback(); flash("Erreur base de données lors de la suppression.", "danger"); app.logger.error(f"DB error during document delete (ID: {doc_id}): {e}", exc_info=True)
    except Exception as e: db.session.rollback(); flash("Erreur inattendue lors de la suppression.", "danger"); app.logger.error(f"Unexpected error during document delete (ID: {doc_id}): {e}", exc_info=True)
    return redirect(redirect_url)
        
# --- API Routes ---
@app.route('/api/dashboard_essential') # From updated_app.py
@db_operation_with_retry(max_retries=2)
def api_dashboard_essential():
    cache_key = 'dashboard_essential_data_v3.2'; cached_data = cache.get(cache_key)
    if cached_data and not app.debug: app.logger.debug(f"API dashboard_essential: Using cached (key: {cache_key})"); return jsonify(cached_data)
    try:
        app.logger.debug("API dashboard_essential: Fetching fresh data from DB.")
        sessions_q = Session.query.options(selectinload(Session.theme), selectinload(Session.salle), selectinload(Session.inscriptions), selectinload(Session.liste_attente)).order_by(Session.date, Session.heure_debut).all()
        sessions_data = []
        for s in sessions_q:
            inscrits_count = sum(1 for insc in s.inscriptions if insc.statut == 'confirmé'); attente_count = len(s.liste_attente); pending_validation_count = sum(1 for insc in s.inscriptions if insc.statut == 'en attente'); max_p = s.max_participants if s.max_participants is not None else 10
            sessions_data.append({'id': s.id, 'date': s.formatage_date, 'horaire': s.formatage_horaire, 'theme': s.theme.nom if s.theme else 'N/A', 'theme_id': s.theme_id, 'places_restantes': max(0, max_p - inscrits_count), 'inscrits': inscrits_count, 'max_participants': max_p, 'liste_attente': attente_count, 'pending_validation_count': pending_validation_count, 'salle': s.salle.nom if s.salle else None, 'salle_id': s.salle_id})
        participants_q = Participant.query.options(joinedload(Participant.service)).order_by(Participant.nom, Participant.prenom).all()
        participants_data = [{'id': p.id, 'nom': p.nom, 'prenom': p.prenom, 'email': p.email, 'service': p.service.nom if p.service else 'N/A', 'service_id': p.service_id, 'service_color': p.service.couleur if p.service and p.service.couleur else '#6c757d'} for p in participants_q]
        activites_q = get_recent_activities(limit=7)
        activites_data = [{'id': a.id, 'type': a.type, 'description': a.description, 'details': a.details, 'date_relative': a.date_relative, 'user': a.utilisateur.username if a.utilisateur else None} for a in activites_q]
        all_services_q = Service.query.order_by(Service.nom).all(); services_list_data = [{'id': srv.id, 'nom': srv.nom} for srv in all_services_q]
        all_salles_q = Salle.query.order_by(Salle.nom).all(); salles_list_data = [{'id': sal.id, 'nom': sal.nom, 'capacite': sal.capacite} for sal in all_salles_q]
        response_data = {'sessions': sessions_data, 'participants': participants_data, 'activites': activites_data, 'services': services_list_data, 'salles': salles_list_data, 'timestamp': datetime.now(UTC).timestamp(), 'status': 'ok'}
        if not app.debug: cache.set(cache_key, response_data, timeout=45)
        app.logger.debug(f"API dashboard_essential: Data fetched. Cached: {not app.debug} (key: {cache_key})")
        return jsonify(response_data)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"API DB Error in dashboard_essential: {e}", exc_info=True); return jsonify({"error": "Database error", "message": str(e), "status": "error"}), 500
    except Exception as e: app.logger.error(f"API Unexpected Error in dashboard_essential: {e}", exc_info=True); return jsonify({"error": "Internal server error", "message": str(e), "status": "error"}), 500

@app.route('/api/session/<int:session_id>/participants_details') # From updated_app.py
@login_required
@db_operation_with_retry(max_retries=2)
def api_session_participants_details(session_id):
    try:
        session = db.session.get(Session, session_id);
        if not session: return jsonify({"error": "Session non trouvée"}), 404
        confirmes = Inscription.query.options(joinedload(Inscription.participant).joinedload(Participant.service)).filter(Inscription.session_id == session_id, Inscription.statut == 'confirmé').order_by(Participant.nom, Participant.prenom).all()
        confirmes_data = [{'id': insc.id, 'participant_id': insc.participant.id, 'nom_complet': f"{insc.participant.prenom} {insc.participant.nom}", 'service_nom': insc.participant.service.nom if insc.participant.service else 'N/A', 'service_couleur': insc.participant.service.couleur if insc.participant.service else '#6c757d', 'date_inscription': insc.date_inscription.strftime('%d/%m/%Y %H:%M')} for insc in confirmes]
        en_attente_validation = Inscription.query.options(joinedload(Inscription.participant).joinedload(Participant.service)).filter(Inscription.session_id == session_id, Inscription.statut == 'en attente').order_by(Inscription.date_inscription.asc()).all()
        en_attente_data = [{'id': insc.id, 'participant_id': insc.participant.id, 'nom_complet': f"{insc.participant.prenom} {insc.participant.nom}", 'service_nom': insc.participant.service.nom if insc.participant.service else 'N/A', 'service_couleur': insc.participant.service.couleur if insc.participant.service else '#6c757d', 'date_demande': insc.date_inscription.strftime('%d/%m/%Y %H:%M')} for insc in en_attente_validation]
        liste_attente = ListeAttente.query.options(joinedload(ListeAttente.participant).joinedload(Participant.service)).filter(ListeAttente.session_id == session_id).order_by(ListeAttente.position.asc()).all()
        liste_attente_data = [{'id': la.id, 'participant_id': la.participant.id, 'nom_complet': f"{la.participant.prenom} {la.participant.nom}", 'service_nom': la.participant.service.nom if la.participant.service else 'N/A', 'service_couleur': la.participant.service.couleur if la.participant.service else '#6c757d', 'date_inscription': la.date_inscription.strftime('%d/%m/%Y %H:%M'), 'position': la.position} for la in liste_attente]
        return jsonify({'confirmes': confirmes_data, 'en_attente_validation': en_attente_data, 'liste_attente': liste_attente_data, 'status': 'ok'})
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"API DB Error session details (SessID: {session_id}): {e}", exc_info=True); return jsonify({"error": "Database error"}), 500
    except Exception as e: app.logger.error(f"API Unexpected Error session details (SessID: {session_id}): {e}", exc_info=True); return jsonify({"error": "Internal server error"}), 500

@app.route('/api/salles') # From original_app.py
@db_operation_with_retry(max_retries=2)
def api_salles():
    result = []
    try:
        salles = Salle.query.order_by(Salle.nom).all()
        for salle in salles:
             count = Session.query.filter_by(salle_id=salle.id).count()
             result.append({'id': salle.id, 'nom': salle.nom, 'capacite': salle.capacite, 'lieu': salle.lieu, 'description': salle.description, 'sessions_count': count})
        return jsonify(result)
    except SQLAlchemyError as e: app.logger.error(f"API Error fetching salles: {e}", exc_info=True); return jsonify({"error": "Database error"}), 500
    except Exception as e: app.logger.error(f"API Unexpected Error fetching salles: {e}", exc_info=True); return jsonify({"error": "Internal server error"}), 500

@app.route('/api/participant/<int:participant_id>/details') # From original_app.py
@login_required 
@db_operation_with_retry(max_retries=2)
def api_participant_details(participant_id):
    app.logger.debug(f"Appel API pour détails participant ID: {participant_id} par user '{current_user.username}'")
    try:
        participant = db.session.get(Participant, participant_id)
        if not participant: app.logger.warning(f"API details: Participant ID {participant_id} non trouvé."); return jsonify({"error": "Participant not found"}), 404
        confirmed_inscriptions = Inscription.query.options(selectinload(Inscription.session).selectinload(Session.theme), selectinload(Inscription.session).selectinload(Session.salle)).filter(Inscription.participant_id == participant_id, Inscription.statut == 'confirmé').order_by(Inscription.date_inscription.desc()).all()
        pending_inscriptions = Inscription.query.options(selectinload(Inscription.session).selectinload(Session.theme), selectinload(Inscription.session).selectinload(Session.salle)).filter(Inscription.participant_id == participant_id, Inscription.statut == 'en attente').order_by(Inscription.date_inscription.desc()).all()
        waitlist_entries = ListeAttente.query.options(selectinload(ListeAttente.session).selectinload(Session.theme), selectinload(ListeAttente.session).selectinload(Session.salle)).filter(ListeAttente.participant_id == participant_id).order_by(ListeAttente.position.asc()).all()
        data = {
            'confirmed': [{'id': i.id, 'session_id': i.session_id, 'theme': i.session.theme.nom if i.session and i.session.theme else 'N/A', 'date': i.session.formatage_date if i.session else 'N/A', 'horaire': i.session.formatage_horaire if i.session else 'N/A', 'salle': i.session.salle.nom if i.session and i.session.salle else 'Non définie', 'date_inscription': i.date_inscription.strftime('%d/%m/%Y %H:%M')} for i in confirmed_inscriptions],
            'pending': [{'id': i.id, 'session_id': i.session_id, 'theme': i.session.theme.nom if i.session and i.session.theme else 'N/A', 'date': i.session.formatage_date if i.session else 'N/A', 'horaire': i.session.formatage_horaire if i.session else 'N/A', 'date_inscription': i.date_inscription.strftime('%d/%m/%Y %H:%M')} for i in pending_inscriptions],
            'waitlist': [{'id': l.id, 'session_id': l.session_id, 'theme': l.session.theme.nom if l.session and l.session.theme else 'N/A', 'date': l.session.formatage_date if l.session else 'N/A', 'horaire': l.session.formatage_horaire if l.session else 'N/A', 'position': l.position, 'date_inscription': l.date_inscription.strftime('%d/%m/%Y %H:%M'), 'notification_envoyee': l.notification_envoyee} for l in waitlist_entries]
        }
        return jsonify(data)
    except SQLAlchemyError as e: app.logger.error(f"API Error participant details {participant_id}: {e}", exc_info=True); return jsonify({"error": "Database error", "details": str(e)}), 500
    except Exception as e: app.logger.error(f"API Unexpected Error participant details {participant_id}: {e}", exc_info=True); return jsonify({"error": "Internal server error", "details": str(e)}), 500

@app.route('/api/sessions-a-venir', methods=['GET']) # From original_app.py
def api_sessions_a_venir():
    try:
        if not current_user.is_authenticated: return jsonify({'error': 'Authentification requise'}), 401
        app.logger.info(f"Utilisateur '{current_user.username}' accède aux sessions à venir via API")
        today = date.today() # Corrected: datetime.date.today() to date.today()
        # Assuming Session model has date_debut, heure_debut, heure_fin, capacite, theme.couleur
        # The original Session model has 'date', 'heure_debut', 'heure_fin', 'max_participants'.
        # I will adapt to the existing Session model.
        upcoming_sessions = Session.query.filter(Session.date >= today).options(joinedload(Session.theme), joinedload(Session.salle)).order_by(Session.date.asc(), Session.heure_debut.asc()).limit(5).all()
        result = []
        for session_obj in upcoming_sessions: # Renamed session to session_obj
            places_occupees = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == session_obj.id, Inscription.statut == 'confirmé').scalar() or 0
            result.append({
                'id': session_obj.id,
                'theme': session_obj.theme.nom if session_obj.theme else 'Non défini',
                'theme_couleur': '#4e73df', # Default color, original model Theme has no couleur
                'date_debut': session_obj.date.strftime('%Y-%m-%d'),
                'heure_debut': session_obj.heure_debut.strftime('%H:%M') if session_obj.heure_debut else '00:00',
                'heure_fin': session_obj.heure_fin.strftime('%H:%M') if session_obj.heure_fin else '00:00',
                'salle': session_obj.salle.nom if session_obj.salle else 'Non définie',
                'capacite': session_obj.max_participants,
                'places_occupees': places_occupees,
                'places_restantes': session_obj.max_participants - places_occupees,
                'complet': places_occupees >= session_obj.max_participants
            })
        app.logger.debug(f"Données de sessions à venir: {len(result)} sessions trouvées")
        return jsonify(result)
    except Exception as e: app.logger.error(f"Erreur lors de la récupération des sessions à venir: {str(e)}", exc_info=True); return jsonify({'error': f'Erreur: {str(e)}'}), 500

@app.route('/api/dashboard-stats', methods=['GET']) # From original_app.py
def api_dashboard_stats():
    try:
        if not current_user.is_authenticated: return jsonify({'error': 'Authentification requise'}), 401
        app.logger.info(f"Utilisateur '{current_user.username}' accède aux statistiques du dashboard via API")
        inscriptions_confirmees = db.session.query(func.count(Inscription.id)).filter(Inscription.statut == 'confirmé').scalar() or 0
        # Original code had 'en_attente' for Inscription.statut. The model uses 'en attente'.
        # This should probably count ListeAttente table or Inscription.statut == 'en attente'
        # The original_app.py admin route counts total_en_attente from ListeAttente.
        # Let's assume 'en_attente' here means entries in the ListeAttente table for consistency.
        en_attente_liste = db.session.query(func.count(ListeAttente.id)).scalar() or 0
        sessions_totales = Session.query.count()
        sessions_completes = 0
        for session_obj in Session.query.all(): # Renamed session to session_obj
            inscrits = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == session_obj.id, Inscription.statut == 'confirmé').scalar() or 0
            if inscrits >= session_obj.max_participants: sessions_completes += 1
        # Original code had User.role == 'participant'. The model has User.role == 'user' by default.
        # Assuming 'participant' role is not standard, count all non-admin users or adjust User model.
        # For now, let's count users with role 'user'.
        participants_totaux = User.query.filter(User.role == 'user').count() 
        documents_disponibles = Document.query.count() # Removed hasattr check as Document model is defined
        result = {
            'inscriptions_confirmees': inscriptions_confirmees,
            'en_attente': en_attente_liste, # Using count from ListeAttente
            'sessions_totales': sessions_totales,
            'sessions_completes': sessions_completes,
            'participants_totaux': participants_totaux,
            'documents_disponibles': documents_disponibles
        }
        app.logger.debug(f"Statistiques du dashboard récupérées avec succès")
        return jsonify(result)
    except Exception as e: app.logger.error(f"Erreur lors de la récupération des statistiques du dashboard: {str(e)}", exc_info=True); return jsonify({'error': f'Erreur: {str(e)}'}), 500

@app.route('/api/admin/stats', methods=['GET']) # From original_app.py
def api_admin_stats():
    try:
        if not current_user.is_authenticated: return jsonify({'error': 'Authentification requise'}), 401
        if current_user.role != 'admin': return jsonify({'error': 'Accès refusé'}), 403 # Corrected: current_user.is_admin to current_user.role == 'admin'
        app.logger.info(f"Admin '{current_user.username}' accède aux statistiques avancées")
        taux_remplissage = []
        # Adapting to Session model: date_debut -> date, capacite -> max_participants
        for session_obj in Session.query.options(joinedload(Session.theme)).all(): # Renamed session to session_obj
            inscrits = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == session_obj.id, Inscription.statut == 'confirmé').scalar() or 0
            taux = (inscrits / session_obj.max_participants * 100) if session_obj.max_participants > 0 else 0
            taux_remplissage.append({'id': session_obj.id, 'theme': session_obj.theme.nom if session_obj.theme else 'Non défini', 'date': session_obj.date.strftime('%d/%m/%Y'), 'inscrits': inscrits, 'capacite': session_obj.max_participants, 'taux': round(taux, 2)})
        
        # Adapting to models: Inscription.user_id -> Inscription.participant_id -> Participant.user_id (if exists) or Participant.service_id
        # The original query joins User to Inscription.user_id. Our Inscription has participant_id. Participant has service_id.
        # User has service_id. So, User -> Service, Participant -> Service.
        # Let's assume participation by service means participants from a service.
        participation_service_q = db.session.query(Service.nom.label('service'), func.count(Inscription.id).label('inscriptions')).join(Participant, Participant.service_id == Service.id).join(Inscription, Inscription.participant_id == Participant.id).filter(Inscription.statut == 'confirmé').group_by(Service.nom).all()
        
        # User model has no derniere_connexion. This stat cannot be computed as is.
        # For now, set utilisateurs_actifs to total users or a placeholder.
        utilisateurs_actifs = User.query.count() # Placeholder
        
        sessions_par_mois_q = db.session.query(func.strftime('%Y-%m', Session.date).label('mois'), func.count(Session.id).label('count')).group_by('mois').all() # Session.date_debut -> Session.date
        
        result = {
            'taux_remplissage': taux_remplissage,
            'participation_service': [{'service': stat.service, 'inscriptions': stat.inscriptions} for stat in participation_service_q],
            'utilisateurs': {'total': User.query.count(), 'actifs': utilisateurs_actifs, 'inactifs': User.query.count() - utilisateurs_actifs},
            'sessions_par_mois': [{'mois': stat.mois, 'count': stat.count} for stat in sessions_par_mois_q]
        }
        return jsonify(result)
    except Exception as e: app.logger.error(f"Erreur lors de la récupération des statistiques admin: {str(e)}", exc_info=True); return jsonify({'error': f'Erreur: {str(e)}'}), 500

@app.route('/api/activites') # From original_app.py
@db_operation_with_retry(max_retries=2)
def api_activites():
    try:
        limit = request.args.get('limit', 10, type=int)
        # Cache key was 'recent_activities_{limit}'. get_recent_activities is already memoized.
        # So, direct call to get_recent_activities is fine.
        activites = get_recent_activities(limit=limit)
        result = [{'id': a.id, 'type': a.type, 'description': a.description, 'details': a.details, 'date_relative': a.date_relative, 'date_iso': a.date.isoformat() if hasattr(a, 'date') and a.date else None, 'user': a.utilisateur.username if a.utilisateur else None} for a in activites]
        return jsonify(result)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"API Error fetching activities: {e}", exc_info=True); return jsonify({"error": "Database error", "message": str(e)}), 500
    except Exception as e: app.logger.error(f"API Unexpected Error fetching activities: {e}", exc_info=True); return jsonify({"error": "Internal server error", "message": str(e)}), 500

# --- NOUVELLES ROUTES POUR LA GESTION DES SESSIONS PAR L'ADMIN --- (From updated_app.py)
@app.route('/admin/sessions')
@login_required 
@db_operation_with_retry()
def admin_sessions_list():
    if current_user.role != 'admin': flash("Accès réservé.", "danger"); return redirect(url_for('dashboard'))
    page = request.args.get('page', 1, type=int)
    sessions_pagination = Session.query.options(joinedload(Session.theme), joinedload(Session.salle)).order_by(Session.date.desc(), Session.heure_debut.desc()).paginate(page=page, per_page=10, error_out=False)
    return render_template('admin_sessions_list.html', sessions_pagination=sessions_pagination, themes=get_all_themes(), salles=get_all_salles())

@app.route('/admin/session/add', methods=['GET', 'POST'])
@login_required 
@db_operation_with_retry()
def admin_add_session():
    if current_user.role != 'admin': flash("Accès réservé.", "danger"); return redirect(url_for('dashboard'))
    if request.method == 'POST':
        try:
            date_str = request.form.get('date'); heure_debut_str = request.form.get('heure_debut'); heure_fin_str = request.form.get('heure_fin'); theme_id = request.form.get('theme_id', type=int); max_participants = request.form.get('max_participants', type=int, default=10); salle_id_str = request.form.get('salle_id'); salle_id = int(salle_id_str) if salle_id_str and salle_id_str.isdigit() else None
            if not all([date_str, heure_debut_str, heure_fin_str, theme_id]): flash("Champs date, heures et thème obligatoires.", "warning")
            else:
                date_obj = date.fromisoformat(date_str); heure_debut_obj = time_obj.fromisoformat(heure_debut_str); heure_fin_obj = time_obj.fromisoformat(heure_fin_str)
                if heure_fin_obj <= heure_debut_obj: flash("L'heure de fin doit être après l'heure de début.", "warning")
                else:
                    new_session = Session(date=date_obj, heure_debut=heure_debut_obj, heure_fin=heure_fin_obj, theme_id=theme_id, max_participants=max_participants, salle_id=salle_id)
                    db.session.add(new_session); db.session.commit()
                    add_activity('ajout_session', f'Ajout session: {new_session.theme.nom if new_session.theme else "N/A"} le {new_session.formatage_date}', user=current_user)
                    flash(f"Session '{new_session.theme.nom if new_session.theme else 'N/A'}' ajoutée.", "success"); cache.delete('dashboard_essential_data_v3.2'); return redirect(url_for('admin_sessions_list'))
        except ValueError: flash("Format date/heure invalide.", "danger")
        except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB ajout session: {e}", exc_info=True); flash("Erreur base de données.", "danger")
        except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue ajout session: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return render_template('admin_session_form.html', themes=get_all_themes(), salles=get_all_salles(), form_action=url_for('admin_add_session'), session_obj=None, page_title="Ajouter Session")

@app.route('/admin/session/<int:session_id>/edit', methods=['GET', 'POST'])
@login_required 
@db_operation_with_retry()
def admin_edit_session(session_id):
    if current_user.role != 'admin': flash("Accès réservé.", "danger"); return redirect(url_for('dashboard'))
    session_obj = db.session.get(Session, session_id);
    if not session_obj: flash("Session introuvable.", "danger"); return redirect(url_for('admin_sessions_list'))
    if request.method == 'POST':
        try:
            session_obj.date = date.fromisoformat(request.form.get('date')); session_obj.heure_debut = time_obj.fromisoformat(request.form.get('heure_debut')); session_obj.heure_fin = time_obj.fromisoformat(request.form.get('heure_fin')); session_obj.theme_id = request.form.get('theme_id', type=int); session_obj.max_participants = request.form.get('max_participants', type=int, default=10); salle_id_str = request.form.get('salle_id'); session_obj.salle_id = int(salle_id_str) if salle_id_str and salle_id_str.isdigit() else None
            if session_obj.heure_fin <= session_obj.heure_debut: flash("L'heure de fin doit être après l'heure de début.", "warning")
            else:
                db.session.commit(); add_activity('modif_session', f'Modif session: {session_obj.theme.nom if session_obj.theme else "N/A"} le {session_obj.formatage_date}', user=current_user); flash(f"Session '{session_obj.theme.nom if session_obj.theme else 'N/A'}' mise à jour.", "success"); cache.delete('dashboard_essential_data_v3.2'); return redirect(url_for('admin_sessions_list'))
        except ValueError: flash("Format date/heure invalide.", "danger")
        except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB modif session {session_id}: {e}", exc_info=True); flash("Erreur base de données.", "danger")
        except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue modif session {session_id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return render_template('admin_session_form.html', themes=get_all_themes(), salles=get_all_salles(), form_action=url_for('admin_edit_session', session_id=session_id), session_obj=session_obj, page_title="Modifier Session")

@app.route('/admin/session/<int:session_id>/delete', methods=['POST'])
@login_required 
@db_operation_with_retry()
def admin_delete_session(session_id):
    if current_user.role != 'admin': flash("Accès réservé.", "danger"); return jsonify({'success': False, 'message': 'Non autorisé'}), 403 if request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' else redirect(url_for('dashboard'))
    session_obj = db.session.get(Session, session_id);
    if not session_obj: flash("Session introuvable.", "danger"); return jsonify({'success': False, 'message': 'Session introuvable'}), 404 if request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' else redirect(url_for('admin_sessions_list'))
    try:
        theme_nom = session_obj.theme.nom if session_obj.theme else "N/A"; session_date_str = session_obj.formatage_date
        # Cascade for inscriptions and liste_attente is handled by Session model
        db.session.delete(session_obj); db.session.commit()
        add_activity('suppr_session', f'Suppression session: {theme_nom} le {session_date_str}', user=current_user); flash(f"Session '{theme_nom}' du {session_date_str} supprimée.", "success"); cache.delete('dashboard_essential_data_v3.2')
        if request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest': return jsonify({'success': True, 'message': 'Session supprimée.'})
        return redirect(url_for('admin_sessions_list'))
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB suppression session {session_id}: {e}", exc_info=True); flash("Erreur DB.", "danger"); return jsonify({'success': False, 'message': 'Erreur DB.'}), 500 if request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' else redirect(url_for('admin_sessions_list'))
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue suppression session {session_id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger"); return jsonify({'success': False, 'message': 'Erreur inattendue.'}), 500 if request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' else redirect(url_for('admin_sessions_list'))

# ==============================================================================
# === Database Initialization (Data Seeding) === (From original_app.py)
# ==============================================================================
def init_db():
    with app.app_context():
        try:
            app.logger.info("Vérification et initialisation des DONNÉES initiales (seeding)...")
            if not check_db_connection(): app.logger.error("Échec connexion DB pendant l'initialisation des données."); return False
            app.logger.info("Vérification des tables supposée faite au démarrage.")
            if Service.query.count() == 0:
                app.logger.info("Initialisation des services (seeding)...")
                services_data = [
                    {'id':'commerce', 'nom':'Commerce Anecoop-Solagora', 'couleur':'#FFC107', 'responsable':'Andreu MIR SOLAGORA', 'email_responsable':'amir@solagora.com'},
                    {'id':'comptabilite', 'nom':'Comptabilité', 'couleur':'#2196F3', 'responsable':'Lisa VAN SCHOORISSE', 'email_responsable':'lvanschoorisse@anecoop-france.com'},
                    {'id':'florensud', 'nom':'Florensud', 'couleur':'#4CAF50', 'responsable':'Antoine LAMY', 'email_responsable':'a.lamy@florensud.fr'},
                    {'id':'informatique', 'nom':'Informatique', 'couleur':'#607D8B', 'responsable':'Kevin BIVIA', 'email_responsable':'kbivia@anecoop-france.com'},
                    {'id':'marketing', 'nom':'Marketing', 'couleur':'#9C27B0', 'responsable':'Camille BROUSSOUX', 'email_responsable':'cbroussoux@anecoop-france.com'},
                    {'id':'qualite', 'nom':'Qualité', 'couleur':'#F44336', 'responsable':'Elodie PHILIBERT', 'email_responsable':'ephilibert@anecoop-france.com'},
                    {'id':'rh', 'nom':'RH', 'couleur':'#FF9800', 'responsable':'Elisabeth GOMEZ', 'email_responsable':'egomez@anecoop-france.com'}
                ]
                for data in services_data: db.session.add(Service(**data))
                db.session.commit(); app.logger.info(f"{len(services_data)} services ajoutés (seed).")
            else: app.logger.info("Services déjà présents (seeding ignoré).")

            if Salle.query.count() == 0:
                app.logger.info("Initialisation des salles (seeding)...")
                salle_tramontane = Salle(nom='Salle Tramontane', capacite=15, lieu='Bâtiment A, RDC', description='Salle de formation polyvalente')
                db.session.add(salle_tramontane); db.session.commit(); app.logger.info("Salle 'Salle Tramontane' ajoutée (seed).")
            else:
                tramontane = Salle.query.filter_by(nom='Salle Tramontane').first()
                if tramontane:
                    if tramontane.capacite != 15 or tramontane.lieu != 'Bâtiment A, RDC': tramontane.capacite = 15; tramontane.lieu = 'Bâtiment A, RDC'; tramontane.description = 'Salle de formation polyvalente'; db.session.commit(); app.logger.info("Salle Tramontane mise à jour.")
                else: salle_tramontane = Salle(nom='Salle Tramontane', capacite=15, lieu='Bâtiment A, RDC', description='Salle de formation polyvalente'); db.session.add(salle_tramontane); db.session.commit(); app.logger.info("Salle 'Salle Tramontane' ajoutée (manquante).")
                app.logger.info("Salles déjà présentes (seeding ignoré, vérification Tramontane).")

            if Theme.query.count() == 0:
                app.logger.info("Initialisation des thèmes (seeding)...")
                themes_data = [
                    {'nom':'Communiquer avec Teams', 'description':'Apprenez à utiliser Microsoft Teams pour communiquer efficacement.'},
                    {'nom':'Gérer les tâches (Planner)', 'description':'Maîtrisez la gestion des tâches d\'équipe avec Planner et To Do.'},
                    {'nom':'Gérer mes fichiers (OneDrive/SharePoint)', 'description':'Organisez et partagez vos fichiers avec OneDrive et SharePoint.'},
                    {'nom':'Collaborer avec Teams', 'description':'Découvrez comment collaborer sur des documents via Microsoft Teams.'}
                ]
                for data in themes_data: db.session.add(Theme(**data))
                db.session.commit(); app.logger.info(f"{len(themes_data)} thèmes ajoutés (seed).")
            else: app.logger.info("Thèmes déjà présents (seeding ignoré)."); update_theme_names()

            if Session.query.count() == 0:
                app.logger.info("Initialisation des sessions (seeding)...")
                try:
                    theme_comm = Theme.query.filter(Theme.nom.like('%Communiquer%')).first(); theme_tasks = Theme.query.filter(Theme.nom.like('%Gérer les tâches%')).first(); theme_files = Theme.query.filter(Theme.nom.like('%Gérer mes fichiers%')).first(); theme_collab = Theme.query.filter(Theme.nom.like('%Collaborer%')).first(); salle_tram = Salle.query.filter_by(nom='Salle Tramontane').first()
                    if not all([theme_comm, theme_tasks, theme_files, theme_collab, salle_tram]): app.logger.error("Impossible d'initialiser sessions: Thèmes/Salle manquants."); raise ValueError("Missing Theme/Salle for session seeding.")
                    sessions_to_add = []
                    session_dates_themes = [
                        ('2025-05-13', [(time_obj(9, 0), time_obj(10, 30), theme_comm.id), (time_obj(10, 45), time_obj(12, 15), theme_comm.id), (time_obj(14, 0), time_obj(15, 30), theme_tasks.id), (time_obj(15, 45), time_obj(17, 15), theme_tasks.id)]),
                        ('2025-06-03', [(time_obj(9, 0), time_obj(10, 30), theme_tasks.id), (time_obj(10, 45), time_obj(12, 15), theme_tasks.id), (time_obj(14, 0), time_obj(15, 30), theme_files.id), (time_obj(15, 45), time_obj(17, 15), theme_files.id)]),
                        ('2025-06-20', [(time_obj(9, 0), time_obj(10, 30), theme_files.id), (time_obj(10, 45), time_obj(12, 15), theme_files.id), (time_obj(14, 0), time_obj(15, 30), theme_collab.id), (time_obj(15, 45), time_obj(17, 15), theme_collab.id)]),
                        ('2025-07-01', [(time_obj(9, 0), time_obj(10, 30), theme_collab.id), (time_obj(10, 45), time_obj(12, 15), theme_collab.id), (time_obj(14, 0), time_obj(15, 30), theme_comm.id), (time_obj(15, 45), time_obj(17, 15), theme_comm.id)])
                    ]
                    for date_str, timeslots in session_dates_themes:
                        date_obj = date.fromisoformat(date_str)
                        for start, end, theme_id_val in timeslots: sessions_to_add.append(Session(date=date_obj, heure_debut=start, heure_fin=end, theme_id=theme_id_val, max_participants=15, salle_id=salle_tram.id))
                    db.session.bulk_save_objects(sessions_to_add); db.session.commit(); app.logger.info(f"{len(sessions_to_add)} sessions ajoutées (seed).")
                except Exception as sess_init_err: db.session.rollback(); app.logger.error(f"Erreur init sessions (seed): {sess_init_err}", exc_info=True)
            else:
                salle_tramontane = Salle.query.filter_by(nom='Salle Tramontane').first()
                if salle_tramontane:
                    updated_count = Session.query.filter(Session.salle_id != salle_tramontane.id).update({'salle_id': salle_tramontane.id})
                    if updated_count > 0: db.session.commit(); app.logger.info(f"{updated_count} sessions réassignées à Salle Tramontane.")
                app.logger.info("Sessions déjà présentes (seeding ignoré, vérification salle).")

            if User.query.count() == 0:
                app.logger.info("Initialisation des utilisateurs (seeding)...")
                admin_user = User(username='admin', email='admin@anecoop-france.com', role='admin'); admin_user.set_password('Anecoop2025'); db.session.add(admin_user)
                users_added_count = 1
                services_list = Service.query.all() # Renamed services to services_list
                for service_item in services_list: # Renamed service to service_item
                    base_username = "".join(filter(str.isalnum, service_item.responsable.split()[0])).lower()[:15]; username = base_username; counter = 1
                    while User.query.filter_by(username=username).first(): username = f"{base_username}{counter}"; counter += 1
                    responsable_user = User(username=username, email=service_item.email_responsable, role='responsable', service_id=service_item.id); responsable_user.set_password('Anecoop2025'); db.session.add(responsable_user); users_added_count += 1
                db.session.commit(); app.logger.info(f"{users_added_count} utilisateurs ajoutés (seed).")
            else: app.logger.info("Utilisateurs déjà présents (seeding ignoré).")

            qualite_service = Service.query.filter_by(id='qualite').first()
            if qualite_service:
                qualite_participants_data = [
                    {'nom': 'PHILIBERT', 'prenom': 'Elodie', 'email': 'ephilibert@anecoop-france.com'}, {'nom': 'SARRAZIN', 'prenom': 'Enora', 'email': 'esarrazin@anecoop-france.com'},
                    {'nom': 'CASTAN', 'prenom': 'Sophie', 'email': 'scastan@anecoop-france.com'}, {'nom': 'BERNAL', 'prenom': 'Paola', 'email': 'pbernal@anecoop-france.com'}
                ]
                participants_added = 0
                for p_data in qualite_participants_data:
                    if not Participant.query.filter(func.lower(Participant.email) == p_data['email'].lower()).first():
                        participant = Participant(nom=p_data['nom'], prenom=p_data['prenom'], email=p_data['email'], service_id=qualite_service.id); db.session.add(participant); participants_added += 1
                if participants_added > 0: db.session.commit(); cache.delete_memoized(get_all_participants_with_service); cache.delete_memoized(get_all_services_with_participants); cache.delete(f'service_participant_count_{qualite_service.id}'); app.logger.info(f"{participants_added} participants Qualité ajoutés (seed).")
                else: app.logger.info("Participants Qualité déjà présents (seeding ignoré).")
            else: app.logger.warning("Service 'qualite' non trouvé, impossible d'ajouter participants Qualité (seed).")

            if Activite.query.count() == 0:
                app.logger.info("Ajout activités initiales (seeding)...")
                admin_user = User.query.filter_by(role='admin').first()
                activites_data = [
                    {'type': 'systeme', 'description': 'Initialisation de l\'application', 'details': 'Base de données et données initiales créées'},
                    {'type': 'systeme', 'description': 'Création des comptes utilisateurs initiaux', 'details': 'Admin et responsables créés', 'utilisateur_id': admin_user.id if admin_user else None}
                ]
                for data in activites_data: db.session.add(Activite(**data))
                db.session.commit(); app.logger.info("Activités initiales ajoutées (seed).")
            app.logger.info("Initialisation des données (seeding) terminée.")
            return True
        except SQLAlchemyError as e: db.session.rollback(); app.logger.exception(f"ÉCHEC INIT DB (SQLAlchemyError seeding): {e}"); print(f"ERREUR INIT DB (SEEDING): {e}"); return False
        except Exception as e: db.session.rollback(); app.logger.exception(f"ERREUR INATTENDUE INIT (SEEDING): {e}"); print(f"ERREUR INIT (SEEDING): {e}"); return False

# ==============================================================================
# === Main Execution === (From original_app.py)
# ==============================================================================
if __name__ == '__main__':
    configure_logging(app)
    is_production = os.environ.get('RENDER') or os.environ.get('FLASK_ENV') == 'production'
    port = int(os.environ.get('PORT', 5000))
    debug_mode = not is_production
    app.debug = debug_mode
    with app.app_context():
        app.logger.info("Application context entered for startup DB checks.")
        db_ready = False
        try:
            connection_ok = check_db_connection()
            if connection_ok:
                app.logger.info("Connexion DB OK.")
                app.logger.info("Vérification/Création des tables DB (db.create_all())...")
                try:
                    db.create_all(); app.logger.info("db.create_all() exécuté avec succès."); db_ready = True
                except OperationalError as op_err: app.logger.error(f"Erreur opérationnelle lors de db.create_all(): {op_err}")
                except Exception as create_err: app.logger.error(f"⚠️ Erreur lors de db.create_all(): {create_err}", exc_info=True); db.session.rollback()
                if db_ready:
                    app.logger.info("Tentative d'initialisation des données (seeding via init_db())...")
                    if not init_db(): app.logger.error("⚠️ Échec de l'initialisation des données initiales (seeding).")
                    else: app.logger.info("Initialisation/Vérification des données initiales terminée.")
                else: app.logger.warning("Skipping data seeding (init_db) because table creation failed.")
            else: app.logger.error("⚠️ ERREUR CONNEXION DB au démarrage."); print("⚠️ ERREUR CONNEXION DB au démarrage.")
        except OperationalError as oe: app.logger.critical(f"⚠️ ERREUR CONNEXION DB CRITIQUE: {oe}"); print(f"⚠️ ERREUR CONNEXION DB CRITIQUE: {oe}"); sys.exit(1)
        except Exception as e: app.logger.critical(f"⚠️ Erreur CRITIQUE init DB: {e}", exc_info=True); print(f"⚠️ Erreur CRITIQUE init DB: {e}"); db.session.rollback(); sys.exit(1)
    try:
        host = '0.0.0.0'
        app.logger.info(f"Démarrage serveur MODE {'PRODUCTION' if is_production else 'DÉVELOPPEMENT'} avec {ASYNC_MODE} sur http://{host}:{port} (Debug: {debug_mode})")
        print(f"Démarrage serveur MODE {'PRODUCTION' if is_production else 'DÉVELOPPEMENT'} avec {ASYNC_MODE} sur http://{host}:{port} (Debug: {debug_mode})")
        if debug_mode: socketio.run(app, host=host, port=port, use_reloader=True, debug=debug_mode, log_output=False, allow_unsafe_werkzeug=True)
        else: print("NOTE: Using Flask's built-in server for production is not recommended. Ensure Gunicorn/Waitress is configured."); socketio.run(app, host=host, port=port, debug=False, use_reloader=False)
    except Exception as e: app.logger.critical(f"⚠️ ERREUR CRITIQUE démarrage serveur: {e}", exc_info=True); print(f"⚠️ ERREUR CRITIQUE démarrage serveur: {e}"); import traceback; traceback.print_exc(); sys.exit(1)

# --- END OF COMPLETE app.py ---
