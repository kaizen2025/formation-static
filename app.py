# ==============================================================================
# app.py - Application Flask pour la Gestion des Formations Microsoft 365
# Version: 1.1.8 - Corrections erreurs de démarrage et ajout route activites_journal
# ==============================================================================

# --- Async Mode Patching (DOIT ÊTRE EN PREMIER) ---
import os
import sys
try:
    import gevent.monkey
    # Patch all standard modules except 'ssl' if it's already imported by something else
    # This is a common pattern to avoid the specific warning you encountered.
    if 'ssl' not in sys.modules:
        gevent.monkey.patch_all()
    else:
        gevent.monkey.patch_all(ssl=False) # Patch everything else
    ASYNC_MODE = 'gevent'
    print("Gevent monkey patching appliqué.")
except ImportError:
    try:
        import eventlet
        if 'ssl' not in sys.modules:
            eventlet.monkey_patch()
        else:
            eventlet.monkey_patch(ssl=False)
        ASYNC_MODE = 'eventlet'
        print("Gevent non trouvé. Eventlet monkey patching appliqué.")
    except ImportError:
        ASYNC_MODE = 'threading'
        print(f"Ni gevent ni eventlet trouvés. Mode asynchrone: {ASYNC_MODE}")


# --- Imports ---
# os, sys déjà importés pour le patching
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
from sqlalchemy import func, text, select # text, select importés

from werkzeug.exceptions import ServiceUnavailable, RequestEntityTooLarge
from werkzeug.routing import BuildError
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from ics import Calendar, Event
from ics.alarm import DisplayAlarm
from whitenoise import WhiteNoise

# --- PostgreSQL Encoding ---
psycopg2.extensions.register_type(psycopg2.extensions.UNICODE)
psycopg2.extensions.register_type(psycopg2.extensions.UNICODEARRAY)

# --- Flask App Creation & Configuration ---
app = Flask(__name__)

def from_json_filter(value):
    """
    Filtre Jinja pour parser une chaîne JSON en objet Python.
    Retourne un dictionnaire vide en cas d'erreur de parsing.
    """
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError) as e:
        # Il est bon de logger l'erreur si elle se produit
        # Utiliser current_app.logger si disponible, sinon print
        logger = current_app.logger if current_app else logging.getLogger(__name__)
        logger.warning(f"from_json_filter: Impossible de parser la valeur JSON : '{str(value)[:50]}...' Erreur: {e}")
        return {} # Retourner un dictionnaire vide ou None, selon la gestion d'erreur souhaitée
        
app.jinja_env.filters['from_json'] = from_json_filter

app.config['THEMES_DATA_FOR_CHART'] = {
    'Communiquer avec Teams': { 'color': '#0078d4', 'description': 'Apprenez à utiliser Microsoft Teams pour communiquer efficacement.' },
    'Gérer les tâches (Planner)': { 'color': '#7719aa', 'description': 'Maîtrisez la gestion des tâches d\'équipe avec Planner et To Do.' },
    'Gérer mes fichiers (OneDrive/SharePoint)': { 'color': '#0364b8', 'description': 'Organisez et partagez vos fichiers avec OneDrive et SharePoint.' },
    'Collaborer avec Teams': { 'color': '#038387', 'description': 'Découvrez comment collaborer sur des documents via Microsoft Teams.' },
    'Non défini': { 'color': '#6c757d', 'description': 'Thème non spécifié.'} # Fallback
}
app.config['SERVICES_DATA_FOR_CHART'] = {
    'Commerce Anecoop-Solagora': { 'color': '#FFC107' },
    'Comptabilité': { 'color': '#2196F3' },
    'Florensud': { 'color': '#4CAF50' },
    'Informatique': { 'color': '#607D8B' },
    'Marketing': { 'color': '#9C27B0' },
    'Qualité': { 'color': '#F44336' },
    'RH': { 'color': '#FF9800' },
    'Non défini': { 'color': '#6c757d'} # Fallback
}

# General Config
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'votre_super_cle_secrete_ici_en_production')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    "DATABASE_URL",
    "postgresql://xvcyuaga:rfodwjclemtvhwvqsrpp@alpha.europe.mkdb.sh:5432/usdtdsgq"
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ECHO'] = False # Mettre à True pour débug SQL détaillé

# SQLAlchemy Pool Config (Ajusté pour Render Free Tier)
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "client_encoding": "UTF8",
    "connect_args": { "options": "-c client_encoding=utf8" },
    'pool_size': 1,
    'max_overflow': 0,
    'pool_timeout': 30, # Augmenté pour donner plus de temps
    'pool_recycle': 180, # Recycler plus fréquemment
    'pool_pre_ping': True
}

# Cache Config
app.config.from_mapping({
    "CACHE_TYPE": "SimpleCache",
    "CACHE_DEFAULT_TIMEOUT": 600
})

# Upload Config
UPLOAD_FOLDER = os.path.join(app.root_path, 'uploads')
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 # 16MB limit

# Create Upload Folder if it doesn't exist
if not os.path.exists(UPLOAD_FOLDER):
    try:
        os.makedirs(UPLOAD_FOLDER)
        print(f"Dossier d'upload créé: {UPLOAD_FOLDER}")
    except OSError as e:
        print(f"ERREUR: Impossible de créer le dossier d'upload {UPLOAD_FOLDER}: {e}")

# --- WhiteNoise Configuration ---
static_folder_root = os.path.join(os.path.dirname(__file__), 'static')
app.wsgi_app = WhiteNoise(app.wsgi_app, root=static_folder_root)
app.wsgi_app.add_files(static_folder_root, prefix='static/')

# --- Flask Extension Initialization ---
db = SQLAlchemy(app)
migrate = Migrate(app, db)
login_manager = LoginManager()
cache = Cache(app)
limiter = Limiter(key_func=get_remote_address)

login_manager.init_app(app)
limiter.init_app(app)
cache.init_app(app)

# --- Flask-Login Configuration ---
login_manager.login_view = 'login'
login_manager.login_message = "Veuillez vous connecter pour accéder à cette page."
login_manager.login_message_category = "info"

# --- SocketIO Initialization ---
socketio_async_mode = ASYNC_MODE
if ASYNC_MODE not in ['gevent', 'eventlet', 'threading']: # Sanity check
    socketio_async_mode = 'threading'

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode=socketio_async_mode, # Utiliser le mode détecté
    engineio_logger=False, # Mettre à True pour débug SocketIO
    logger=False,          # Mettre à True pour débug SocketIO
    ping_timeout=20000,
    ping_interval=25000,
    manage_session=False # Important avec Flask-Login
)

# --- Logging Configuration ---
logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
if not os.path.exists(logs_dir):
    try: os.makedirs(logs_dir)
    except OSError as e: print(f"ERREUR: Impossible de créer le dossier de logs {logs_dir}: {e}")
    

# ENREGISTREMENT DU FILTRE (SI OPTION 2 CHOISIE)
app.jinja_env.filters['from_json'] = from_json_filter

def configure_logging(app_instance):
    log_level = logging.DEBUG if app_instance.debug else logging.INFO
    app_instance.logger.handlers = [] # Effacer les handlers par défaut
    # logging.getLogger('sqlalchemy.engine').handlers = [] # Ne pas effacer si on veut les logs SQL
    # logging.getLogger('socketio').handlers = []
    # logging.getLogger('engineio').handlers = []

    formatter = logging.Formatter('%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]')
    
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)
    app_instance.logger.addHandler(console_handler)
    app_instance.logger.setLevel(log_level)

    if not app_instance.debug:
        try:
            app_log_file = os.path.join(logs_dir, 'app.log')
            file_handler = RotatingFileHandler(app_log_file, maxBytes=5*1024*1024, backupCount=5, encoding='utf-8')
            file_handler.setFormatter(formatter)
            file_handler.setLevel(logging.INFO)
            app_instance.logger.addHandler(file_handler)

            # Configurer le logger SQLAlchemy pour les erreurs DB en production
            db_logger = logging.getLogger('sqlalchemy.engine')
            db_log_file = os.path.join(logs_dir, 'db_errors.log')
            db_error_handler = RotatingFileHandler(db_log_file, maxBytes=2*1024*1024, backupCount=3, encoding='utf-8')
            db_error_handler.setFormatter(formatter)
            db_error_handler.setLevel(logging.WARNING) # Log WARNING, ERROR, CRITICAL
            db_logger.addHandler(db_error_handler)
            db_logger.setLevel(logging.WARNING) # S'assurer que le logger lui-même est à ce niveau
            db_logger.propagate = False # Empêcher les logs SQL de remonter au logger root de Flask

            app_instance.logger.info('Logging de production initialisé (fichiers).')
        except Exception as e:
            app_instance.logger.error(f"Erreur lors de la configuration du logging de fichier: {e}")
    else:
        # En mode debug, on peut vouloir voir plus de logs SQL
        # logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO) # Décommenter pour voir les requêtes SQL
        app_instance.logger.info('Logging de développement initialisé (console).')

# configure_logging(app) # Sera appelé dans if __name__ == '__main__'

# --- Context Processors and Teardown ---
@app.context_processor
def inject_global_template_vars():
    return dict(
        debug_mode=app.debug,
        now=datetime.now(UTC),
        app_name="Formation Microsoft 365 - Anecoop France"
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
def limit_connections_if_needed():
    try:
        if request.path.startswith('/static/'): return None
        connection_errors = getattr(app, '_connection_errors', 0)
        if connection_errors > 10: # Seuil d'erreurs de connexion
            # Vérifier si la dernière erreur est suffisamment ancienne pour réinitialiser le compteur
            if hasattr(app, '_last_connection_error') and (datetime.now(UTC) - app._last_connection_error).total_seconds() > 300: # 5 minutes
                app._connection_errors = 0 # Réinitialiser le compteur
                return None # Autoriser la requête
            # Si les erreurs sont récentes, limiter l'accès aux API non essentielles
            if request.path.startswith('/api/') and not request.path.endswith('_essential'):
                return jsonify({"error": "Service temporarily at capacity", "message": "Server load high."}), 429
    except Exception as e: app.logger.error(f"Error in limiting connections: {e}")
    return None # Autoriser la requête par défaut

# --- DB Retry Decorator ---
def db_operation_with_retry(max_retries=3, retry_delay=0.5,
                            retry_on_exceptions=(OperationalError, TimeoutError),
                            fail_on_exceptions=(IntegrityError, SQLAlchemyError)): # SQLAlchemyError est générique, attention
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            last_exception = None
            while retries < max_retries:
                try:
                    return func(*args, **kwargs)
                except retry_on_exceptions as e:
                    retries += 1
                    last_exception = e
                    app.logger.warning(f"DB op '{func.__name__}' failed (attempt {retries}/{max_retries}): {type(e).__name__} - {e}")
                    try: db.session.rollback()
                    except Exception as rb_ex: app.logger.error(f"Rollback error in retry decorator for '{func.__name__}': {rb_ex}")
                    if retries >= max_retries:
                        app.logger.error(f"Max retries ({max_retries}) reached for DB op '{func.__name__}'. Last error: {e}")
                        raise ServiceUnavailable(f"DB service for '{func.__name__}' unavailable after retries.")
                    # Exponential backoff with jitter
                    wait_time = (retry_delay * (2 ** (retries -1))) + random.uniform(0, retry_delay * 0.25)
                    app.logger.info(f"Retrying DB op '{func.__name__}' in {wait_time:.2f}s...")
                    time.sleep(wait_time)
                except fail_on_exceptions as e: # Erreurs non récupérables par retry
                    db.session.rollback()
                    app.logger.error(f"SQLAlchemyError (not retried) in DB op '{func.__name__}': {e}", exc_info=True)
                    raise # Renvoyer l'exception originale
                except Exception as e: # Autres erreurs Python inattendues
                    db.session.rollback()
                    app.logger.error(f"Unexpected Python error in DB op '{func.__name__}': {e}", exc_info=True)
                    raise
            # Si la boucle se termine sans return (ne devrait pas arriver si max_retries > 0)
            if last_exception: raise ServiceUnavailable(f"DB service for '{func.__name__}' unavailable after {max_retries} retries. Last error: {last_exception}")
            raise ServiceUnavailable(f"DB service for '{func.__name__}' unavailable after {max_retries} retries (unknown reason).") # Fallback
        return wrapper
    return decorator

# ==============================================================================
# === Database Models ===
# ==============================================================================

class Service(db.Model):
    __tablename__ = 'service'
    id = db.Column(db.String(20), primary_key=True) # Ex: 'commerce', 'rh'
    nom = db.Column(db.String(100), nullable=False, unique=True)
    couleur = db.Column(db.String(7), nullable=False, default='#6c757d') # Hex color
    responsable = db.Column(db.String(100), nullable=False)
    email_responsable = db.Column(db.String(100), nullable=False)
    participants = db.relationship('Participant', backref='service', lazy='select') # 'select' is default, good for most cases
    users = db.relationship('User', backref='service', lazy='select')
    def __repr__(self): return f'<Service {self.id}: {self.nom}>'

class Salle(db.Model):
    __tablename__ = 'salle'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False, unique=True)
    capacite = db.Column(db.Integer, default=10, nullable=False)
    lieu = db.Column(db.String(200), nullable=True)
    description = db.Column(db.Text, nullable=True)
    sessions = db.relationship('Session', backref='salle', lazy='dynamic') # 'dynamic' for large collections
    def __repr__(self): return f'<Salle {self.id}: {self.nom}>'

class Theme(db.Model):
    __tablename__ = 'theme'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False, unique=True)
    description = db.Column(db.Text, nullable=True)
    sessions = db.relationship('Session', backref='theme', lazy='select') # 'select' is fine if num sessions per theme is small
    documents = db.relationship('Document', backref='theme', lazy='select', cascade="all, delete-orphan")
    def __repr__(self): return f'<Theme {self.id}: {self.nom}>'

class Document(db.Model):
    __tablename__ = 'document'
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False, unique=True) # Nom de fichier stocké sur le serveur (sécurisé et unique)
    original_filename = db.Column(db.String(255), nullable=False) # Nom de fichier original
    description = db.Column(db.Text, nullable=True)
    upload_date = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False)
    theme_id = db.Column(db.Integer, db.ForeignKey('theme.id'), nullable=True, index=True) # Peut être null pour les docs généraux
    uploader_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    file_type = db.Column(db.String(50), nullable=True) # e.g., 'pdf', 'docx'
    uploader = db.relationship('User', backref=db.backref('uploaded_documents', lazy='dynamic'))
    # 'theme' est défini par le backref dans Theme
    def __repr__(self): return f'<Document {self.id}: {self.original_filename}>'

class Session(db.Model):
    __tablename__ = 'session'
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, index=True)
    heure_debut = db.Column(db.Time, nullable=False)
    heure_fin = db.Column(db.Time, nullable=False)
    theme_id = db.Column(db.Integer, db.ForeignKey('theme.id'), nullable=False, index=True)
    max_participants = db.Column(db.Integer, default=10, nullable=False)
    salle_id = db.Column(db.Integer, db.ForeignKey('salle.id'), nullable=True, index=True) # Peut être null
    # Utiliser selectinload pour charger les inscriptions et listes d'attente en une seule fois quand la session est chargée
    inscriptions = db.relationship('Inscription', backref='session', lazy='selectin', cascade="all, delete-orphan")
    liste_attente = db.relationship('ListeAttente', backref='session', lazy='selectin', cascade="all, delete-orphan")

    def get_places_restantes(self, confirmed_count=None):
        try:
            if confirmed_count is None:
                # Compter directement dans la liste préchargée si disponible
                if hasattr(self, '_sa_instance_state') and 'inscriptions' in self._sa_instance_state.committed_state:
                    confirmed_count = sum(1 for i in self.inscriptions if i.statut == 'confirmé')
                else: # Fallback à une requête si non préchargé (moins efficace)
                    confirmed_count = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == self.id, Inscription.statut == 'confirmé').scalar() or 0
            
            max_p = 10 # Valeur par défaut
            if self.max_participants is not None:
                try: max_p = int(self.max_participants)
                except (ValueError, TypeError): pass # Garder la valeur par défaut si invalide
            return max(0, max_p - confirmed_count)
        except Exception as e:
            app.logger.error(f"Error calculating places restantes for S:{self.id}: {e}")
            return 0 # Retourner 0 en cas d'erreur

    @property
    def formatage_date(self):
        try:
            jours = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
            mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
            return f"{jours[self.date.weekday()]} {self.date.day} {mois[self.date.month-1]} {self.date.year}"
        except Exception: return self.date.strftime('%d/%m/%Y') # Fallback

    @property
    def formatage_horaire(self):
        try:
            debut = f"{self.heure_debut.hour:02d}h{self.heure_debut.minute:02d}"
            fin = f"{self.heure_fin.hour:02d}h{self.heure_fin.minute:02d}"
            return f"{debut}–{fin}"
        except Exception: return f"{self.heure_debut.strftime('%H:%M')}–{self.heure_fin.strftime('%H:%M')}" # Fallback

    @property
    def formatage_ics(self):
        try:
            if not isinstance(self.date, date) or not isinstance(self.heure_debut, time_obj) or not isinstance(self.heure_fin, time_obj):
                app.logger.error(f"ICS Formatting Error S:{self.id}: Invalid date/time types.")
                now_utc = datetime.now(UTC); return now_utc, now_utc + timedelta(hours=1)

            naive_start_dt = datetime.combine(self.date, self.heure_debut)
            naive_end_dt = datetime.combine(self.date, self.heure_fin)
            
            # Convertir en UTC. Supposer que les heures sont locales au serveur si pas de tzinfo.
            # Pour une application réelle, il faudrait gérer les fuseaux horaires correctement.
            # Ici, on va supposer que les heures saisies sont dans le fuseau horaire du serveur
            # et les convertir en UTC.
            try:
                # Si les datetimes sont déjà aware, les convertir en UTC
                if naive_start_dt.tzinfo is not None:
                    start_utc = naive_start_dt.astimezone(UTC)
                    end_utc = naive_end_dt.astimezone(UTC)
                else: # Sinon, les considérer comme locales et les convertir
                    start_dt_aware = naive_start_dt.astimezone() # Localize to system timezone
                    end_dt_aware = naive_end_dt.astimezone()
                    start_utc = start_dt_aware.astimezone(UTC)
                    end_utc = end_dt_aware.astimezone(UTC)
            except Exception as tz_err: # Fallback si la conversion de fuseau horaire échoue
                app.logger.warning(f"ICS Timezone Warning S:{self.id}: Assuming naive times are UTC due to error. Error: {tz_err}")
                start_utc = naive_start_dt.replace(tzinfo=UTC)
                end_utc = naive_end_dt.replace(tzinfo=UTC)

            if end_utc <= start_utc: # S'assurer que la fin est après le début
                app.logger.warning(f"ICS Formatting Warning S:{self.id}: End time not after start. Adjusting.")
                end_utc = start_utc + timedelta(hours=1) # Durée par défaut d'1 heure
            return start_utc, end_utc
        except Exception as e:
            app.logger.error(f"Critical error in formatage_ics for S:{self.id}: {e}", exc_info=True)
            now_utc = datetime.now(UTC); return now_utc, now_utc + timedelta(hours=1) # Fallback sûr

    def __repr__(self):
        theme_nom = self.theme.nom if self.theme else "N/A"
        return f'<Session {self.id} - {theme_nom} le {self.date.strftime("%Y-%m-%d")}>'

class Participant(db.Model):
    __tablename__ = 'participant'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    prenom = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), nullable=False, unique=True, index=True)
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=False, index=True)
    
    # MODIFICATION ICI:
    inscriptions = db.relationship('Inscription', backref='participant', lazy='selectin', cascade="all, delete-orphan")
    liste_attente = db.relationship('ListeAttente', backref='participant', lazy='selectin', cascade="all, delete-orphan")
    
    def __repr__(self): return f'<Participant {self.id}: {self.prenom} {self.nom}>'

class Inscription(db.Model):
    __tablename__ = 'inscription'
    id = db.Column(db.Integer, primary_key=True)
    participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False, index=True)
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False, index=True)
    date_inscription = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False)
    statut = db.Column(db.String(20), default='en attente', nullable=False, index=True) # 'en attente', 'confirmé', 'refusé', 'annulé'
    validation_responsable = db.Column(db.Boolean, default=False, nullable=False)
    presence = db.Column(db.Boolean, default=None, nullable=True) # Null = non marqué, True = présent, False = absent
    notification_envoyee = db.Column(db.Boolean, default=False, nullable=False) # Pour rappels, etc.
    __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_inscription'),) # Un participant ne peut s'inscrire qu'une fois à une session
    def __repr__(self): return f'<Inscription {self.id} - P:{self.participant_id} S:{self.session_id} Statut:{self.statut}>'

class ListeAttente(db.Model):
    __tablename__ = 'liste_attente'
    id = db.Column(db.Integer, primary_key=True)
    participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False, index=True)
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False, index=True)
    date_inscription = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False)
    position = db.Column(db.Integer, nullable=False)
    notification_envoyee = db.Column(db.Boolean, default=False, nullable=False) # Si notifié qu'une place s'est libérée
    __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_liste_attente'),) # Un participant ne peut être qu'une fois en liste d'attente pour une session
    def __repr__(self): return f'<ListeAttente {self.id} - P:{self.participant_id} S:{self.session_id} Pos:{self.position}>'

class Activite(db.Model):
    __tablename__ = 'activite'
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(50), nullable=False, index=True) # Ex: 'inscription', 'connexion', 'systeme'
    description = db.Column(db.Text, nullable=False) # Ex: "Inscription de John Doe à la session X"
    details = db.Column(db.Text, nullable=True) # Ex: JSON avec plus d'infos, ou texte libre
    date = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False, index=True)
    utilisateur_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True) # Qui a fait l'action (si applicable)
    utilisateur = db.relationship('User', backref='activites_generees', foreign_keys=[utilisateur_id])

    @property
    def date_relative(self):
        now = datetime.now(UTC)
        # S'assurer que self.date est offset-aware (UTC)
        aware_date = self.date.replace(tzinfo=UTC) if self.date.tzinfo is None else self.date.astimezone(UTC)
        
        if not isinstance(aware_date, datetime): return "Date invalide"
        try:
            if aware_date > now: return f"le {aware_date.strftime('%d/%m/%Y à %H:%M')}" # Pour les événements futurs (peu probable ici)
            
            diff = now - aware_date
            seconds = diff.total_seconds()

            if seconds < 5: return "à l'instant"
            if seconds < 60: s = 's' if int(seconds) >= 2 else ''; return f"il y a {int(seconds)} seconde{s}"
            if seconds < 3600: m = int(seconds // 60); s = 's' if m >= 2 else ''; return f"il y a {m} minute{s}"
            if seconds < 86400: h = int(seconds // 3600); s = 's' if h >= 2 else ''; return f"il y a {h} heure{s}"
            
            days = int(seconds // 86400)
            if days == 1: return "hier"
            if days <= 7: return f"il y a {days} jours"
            
            return f"le {aware_date.strftime('%d/%m/%Y')}" # Pour les dates plus anciennes
        except Exception as e:
            app.logger.error(f"Error calculating relative date for activity {self.id}: {e}")
            return "Date inconnue"

    def __repr__(self): return f'<Activite {self.id} - Type:{self.type} Date:{self.date.strftime("%Y-%m-%d %H:%M")}>'

class User(UserMixin, db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False) # Peut être utilisé pour la récupération de mdp
    role = db.Column(db.String(20), default='user', nullable=False, index=True) # 'user', 'responsable', 'admin'
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=True) # Pour les responsables de service
    # activites_generees défini par backref dans Activite
    # uploaded_documents défini par backref dans Document

    def set_password(self, password): self.password_hash = generate_password_hash(password)
    def check_password(self, password): return check_password_hash(self.password_hash, password)
    def __repr__(self): return f'<User {self.id}: {self.username} ({self.role})>'

# ==============================================================================
# === Flask-Login Configuration ===
# ==============================================================================
@login_manager.user_loader
def load_user(user_id):
    try: return db.session.get(User, int(user_id))
    except Exception as e: app.logger.error(f"Error loading user {user_id}: {e}"); return None

# ==============================================================================
# === Helper Functions ===
# ==============================================================================

@db_operation_with_retry(max_retries=3)
def check_db_connection():
    try:
        db.session.execute(text("SELECT 1"))
        return True
    except Exception as e:
        app.logger.error(f"DB Connection health check failed: {e}")
        db.session.rollback() # Important de rollback en cas d'échec de connexion
        return False

def generate_ics(session, participant, salle=None):
    app.logger.info(f"--- generate_ics called ---")
    app.logger.info(f"Attempting for S_ID:{getattr(session, 'id', 'None')}, P_ID:{getattr(participant, 'id', 'None')}")
    try:
        if not session: app.logger.error("ICS Gen Error: Session object is None."); return None
        if not hasattr(session, 'theme') or not session.theme or not hasattr(session.theme, 'nom') or not session.theme.nom:
            app.logger.error(f"ICS Gen Error: Session S_ID:{getattr(session, 'id', 'N/A')} - theme or theme.nom is missing or invalid.")
            return None
        if not participant: app.logger.error("ICS Gen Error: Participant object is None."); return None
        if not hasattr(participant, 'prenom') or not participant.prenom or not hasattr(participant, 'nom') or not participant.nom:
            app.logger.error(f"ICS Gen Error: Participant P_ID:{getattr(participant, 'id', 'N/A')} - prenom or nom is missing.")
            return None

        cal = Calendar()
        event = Event()
        
        date_debut_utc, date_fin_utc = session.formatage_ics
        if not isinstance(date_debut_utc, datetime) or not isinstance(date_fin_utc, datetime) or \
           date_debut_utc.tzinfo != UTC or date_fin_utc.tzinfo != UTC:
            app.logger.error(f"ICS Gen Error S_ID:{session.id}: formatage_ics did not return valid UTC datetime objects.")
            return None

        event.name = f"Formation: {session.theme.nom}"
        event.begin = date_debut_utc
        event.end = date_fin_utc
        
        description_parts = ["FORMATION MICROSOFT 365 - ANECOOP FRANCE", f"\nThème: {session.theme.nom}"]
        if hasattr(session, 'theme') and session.theme and hasattr(session.theme, 'description') and session.theme.description:
            description_parts.append(f"Détails du thème: {session.theme.description}")
        
        description_parts.extend([
            f"\nDate: {session.formatage_date}",
            f"Horaire: {session.formatage_horaire}"
        ])
        
        location_str = "Salle non définie"
        if salle and hasattr(salle, 'nom') and salle.nom:
            location_str = salle.nom
            description_parts.append(f"\nLieu: {salle.nom}")
            if hasattr(salle, 'lieu') and salle.lieu:
                description_parts.append(f"Emplacement précis: {salle.lieu}")
        else:
            description_parts.append("\nLieu: Salle non définie")
        event.location = location_str
        
        description_parts.append(f"\nParticipant: {participant.prenom} {participant.nom}")
        event.description = "\n".join(description_parts)
        
        event.uid = f"session-{session.id}-participant-{participant.id}-{date_debut_utc.strftime('%Y%m%dT%H%M%SZ')}@anecoop-france.com"
        event.created = datetime.now(UTC)
        event.last_modified = datetime.now(UTC)
        event.status = "CONFIRMED"
        
        alarm = DisplayAlarm(trigger=timedelta(hours=-1)) # Rappel 1h avant
        alarm.description = f"Rappel: Formation {session.theme.nom}"
        event.alarms.add(alarm)
        
        cal.events.add(event)
        serialized_cal = cal.serialize()
        app.logger.info(f"ICS generated successfully for S_ID:{session.id}, P_ID:{participant.id}. Size: {len(serialized_cal)} bytes.")
        return serialized_cal

    except AttributeError as ae:
        app.logger.error(f"ICS Gen AttributeError S_ID:{getattr(session, 'id', 'N/A')}, P_ID:{getattr(participant, 'id', 'N/A')}: {ae}", exc_info=True)
        return None
    except Exception as e:
        app.logger.error(f"Critical error during ICS generation for S_ID:{getattr(session, 'id', 'N/A')}, P_ID:{getattr(participant, 'id', 'N/A')}: {e}", exc_info=True)
        return None

@db_operation_with_retry(max_retries=3)
def check_waitlist(session_id):
    try:
        session = db.session.get(Session, session_id)
        if not session:
            app.logger.warning(f"check_waitlist called for non-existent session {session_id}")
            return False

        if session.get_places_restantes() <= 0: # Pas de place, on ne fait rien
            return False

        # Trouver le prochain sur la liste d'attente qui n'a pas été notifié
        next_in_line = ListeAttente.query.filter_by(session_id=session_id, notification_envoyee=False).order_by(ListeAttente.position).first()
        if next_in_line:
            next_in_line.notification_envoyee = True # Marquer comme notifié
            db.session.commit()
            # Envoyer une notification (par exemple, via SocketIO ou email)
            socketio.emit('notification', {
                'event': 'place_disponible',
                'message': f"Une place s'est libérée pour la formation '{session.theme.nom}' du {session.formatage_date}!",
                'session_id': session_id,
                'participant_id': next_in_line.participant_id
            }, room=f'user_{next_in_line.participant_id}') # Room spécifique à l'utilisateur si implémenté
            add_activity('notification', f'Notification place dispo envoyée', f'Session: {session.theme.nom}, Part: {next_in_line.participant.prenom} {next_in_line.participant.nom}')
            app.logger.info(f"Notified P:{next_in_line.participant_id} for S:{session_id} waitlist opening.")
            return True
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error during check_waitlist for S:{session_id}: {e}")
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error during check_waitlist for S:{session_id}: {e}", exc_info=True)
    return False

@db_operation_with_retry(max_retries=3)
def add_activity(type, description, details=None, user=None):
    try:
        log_user = user if user else current_user
        user_id_for_db = None
        if log_user and hasattr(log_user, 'is_authenticated') and log_user.is_authenticated:
            user_id_for_db = log_user.id
        
        activite = Activite(type=type, description=description, details=details, utilisateur_id=user_id_for_db)
        db.session.add(activite)
        db.session.commit()
        db.session.refresh(activite) # Pour obtenir l'ID et les valeurs par défaut comme la date

        # Préparer les données pour SocketIO
        user_username = activite.utilisateur.username if activite.utilisateur else None
        date_rel = activite.date_relative # Utiliser la propriété pour le format relatif

        try:
            socketio.emit('nouvelle_activite', {
                'id': activite.id,
                'type': activite.type,
                'description': activite.description,
                'details': activite.details,
                'date_relative': date_rel,
                'user': user_username
            }, room='general')
        except Exception as socket_err:
            app.logger.warning(f"SocketIO emit failed in add_activity: {socket_err}")

        app.logger.debug(f"Activity logged: {type} - {description}")
        # Invalider les caches pertinents
        cache.delete_memoized(get_recent_activities) # Si cette fonction est mise en cache
        cache.delete('dashboard_essential_data') # Si les activités récentes font partie de ce cache
        return True
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error adding activity '{type}': {e}")
        return False
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error adding activity '{type}': {e}", exc_info=True)
        return False

@db_operation_with_retry(max_retries=3)
def update_theme_names():
    """Standardise les noms et descriptions des thèmes principaux."""
    with app.app_context():
        try:
            changes_made = False
            # Thème OneDrive/SharePoint
            onedrive_theme = Theme.query.filter(Theme.nom.like('%OneDrive%')).first()
            target_name_files = 'Gérer mes fichiers (OneDrive/SharePoint)'
            target_desc_files = 'Apprenez à organiser et partager vos fichiers avec OneDrive et SharePoint.'
            if onedrive_theme and (onedrive_theme.nom != target_name_files or onedrive_theme.description != target_desc_files):
                onedrive_theme.nom = target_name_files
                onedrive_theme.description = target_desc_files
                changes_made = True
                app.logger.info(f"Standardized theme: {target_name_files}")

            # Thème Collaborer avec Teams
            collaborer_theme = Theme.query.filter(Theme.nom.like('%Collaborer%')).first()
            target_name_collab = 'Collaborer avec Teams'
            target_desc_collab = 'Découvrez comment collaborer sur des documents avec Microsoft Teams.'
            if collaborer_theme and (collaborer_theme.nom != target_name_collab or collaborer_theme.description != target_desc_collab):
                collaborer_theme.nom = target_name_collab
                collaborer_theme.description = target_desc_collab
                changes_made = True
                app.logger.info(f"Standardized theme: {target_name_collab}")
            
            if changes_made:
                db.session.commit()
                cache.delete_memoized(get_all_themes) # Invalider le cache des thèmes
                print("Noms/descriptions des thèmes standardisés.")
            else:
                print("Noms/descriptions des thèmes déjà standardisés.")
        except SQLAlchemyError as e:
            db.session.rollback()
            app.logger.error(f"DB error standardizing theme names: {e}")
            print("Erreur DB lors de la standardisation des thèmes.")
        except Exception as e:
            db.session.rollback()
            app.logger.error(f"Unexpected error standardizing theme names: {e}")
            print("Erreur inattendue lors de la standardisation des thèmes.")

@cache.memoize(timeout=300) # Cache pendant 5 minutes
@db_operation_with_retry(max_retries=3)
def get_all_themes():
    app.logger.debug("Cache miss or expired: Fetching all themes with sessions from DB.")
    return Theme.query.options(selectinload(Theme.sessions)).order_by(Theme.nom).all()

@cache.memoize(timeout=300)
@db_operation_with_retry(max_retries=3)
def get_all_services_with_participants():
    app.logger.debug("Cache miss or expired: Fetching all services with participants from DB.")
    # Ceci retourne une liste d'objets Service, avec la relation 'participants' préchargée.
    return Service.query.options(selectinload(Service.participants)).order_by(Service.nom).all()

@cache.memoize(timeout=180) # Cache pendant 3 minutes
@db_operation_with_retry(max_retries=3)
def get_all_salles():
    app.logger.debug("Cache miss or expired: Fetching all salles from DB.")
    return Salle.query.order_by(Salle.nom).all()

@cache.memoize(timeout=180)
@db_operation_with_retry(max_retries=3)
def get_all_participants_with_service():
    app.logger.debug("Cache miss or expired: Fetching all participants with service from DB.")
    return Participant.query.options(joinedload(Participant.service)).order_by(Participant.nom, Participant.prenom).all()

@cache.memoize(timeout=60) # Cache pendant 1 minute
@db_operation_with_retry(max_retries=2)
def get_recent_activities(limit=10):
    app.logger.debug(f"Cache miss or expired: Fetching {limit} recent activities from DB.")
    return Activite.query.options(joinedload(Activite.utilisateur)).order_by(Activite.date.desc()).limit(limit).all()

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ==============================================================================
# === Jinja Global Functions / Filters ===
# ==============================================================================

def get_activity_icon_jinja(activity_type_str):
    if not isinstance(activity_type_str, str):
        activity_type_str = 'default' # Fallback si le type n'est pas une chaîne

    icon_map = {
        'inscription': 'fas fa-user-plus text-success',
        'validation': 'fas fa-check-circle text-primary',
        'refus': 'fas fa-times-circle text-danger',
        'annulation': 'fas fa-ban text-danger',
        'liste_attente': 'fas fa-clock text-warning',
        'attribution_salle': 'fas fa-map-marker-alt text-info',
        'ajout_participant': 'fas fa-user-plus text-success',
        'suppression_participant': 'fas fa-user-minus text-danger',
        'modification_participant': 'fas fa-user-edit text-warning',
        'ajout_salle': 'fas fa-door-open text-info',
        'modification_salle': 'fas fa-edit text-info',
        'suppression_salle': 'fas fa-trash-alt text-danger',
        'ajout_theme': 'fas fa-book-medical text-success',
        'modification_theme': 'fas fa-edit text-warning',
        'suppression_theme': 'fas fa-trash-alt text-danger',
        'ajout_service': 'fas fa-concierge-bell text-success',
        'modification_service': 'fas fa-cogs text-warning',
        'suppression_service': 'fas fa-minus-circle text-danger',
        'connexion': 'fas fa-sign-in-alt text-primary',
        'deconnexion': 'fas fa-sign-out-alt text-secondary',
        'systeme': 'fas fa-cogs text-secondary',
        'notification': 'fas fa-bell text-warning',
        'telecharger_invitation': 'far fa-calendar-plus text-primary',
        'ajout_document': 'fas fa-file-upload text-info',
        'suppression_document': 'fas fa-file-excel text-danger', # fas fa-file-times pourrait être mieux
        'reinscription': 'fas fa-redo text-info',
        'default': 'fas fa-info-circle text-secondary'
    }
    return icon_map.get(activity_type_str.lower(), icon_map['default'])

app.jinja_env.globals.update(getActivityIcon=get_activity_icon_jinja)

# ==============================================================================
# === WebSocket Event Handlers ===
# ==============================================================================
@socketio.on('connect')
def handle_connect():
    app.logger.info(f'Client connected: {request.sid}')
    emit('status', {'msg': 'Connected to server'}) # Confirmation de connexion
    join_room('general') # Tous les clients rejoignent la room 'general'

@socketio.on('disconnect')
def handle_disconnect():
    app.logger.info(f'Client disconnected: {request.sid}')

@socketio.on('join')
def handle_join(data):
    room = data.get('room', 'general') # 'general' par défaut
    sid = request.sid
    join_room(room)
    app.logger.info(f'Client {sid} joined room: {room}')
    emit('status', {'msg': f'Joined room {room}'}, room=sid) # Confirmer à ce client spécifique

@socketio.on('heartbeat') # Pour maintenir la connexion active si nécessaire
def handle_heartbeat(data):
    emit('heartbeat_response', {'timestamp': datetime.now(UTC).timestamp()})

# ==============================================================================
# === Flask Routes ===
# ==============================================================================

# --- Core Navigation & Auth ---
@app.route('/')
def index():
    return redirect(url_for('dashboard'))

@app.route('/login', methods=['GET', 'POST'])
@db_operation_with_retry(max_retries=3)
def login():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        remember = True # request.form.get('remember') # Optionnel

        if not username or not password:
            flash('Nom d\'utilisateur et mot de passe requis.', 'warning')
            return render_template('login.html')
        try:
            user = User.query.filter(func.lower(User.username) == func.lower(username)).first()
            if user and user.check_password(password):
                login_user(user, remember=remember)
                add_activity('connexion', f'Connexion de {user.username}', user=user)
                next_page = request.args.get('next')
                # Sécurité : s'assurer que next_page est une URL relative locale
                if next_page and next_page.startswith('/') and not next_page.startswith('//'):
                    return redirect(next_page)
                return redirect(url_for('dashboard'))
            else:
                flash('Nom d\'utilisateur ou mot de passe incorrect.', 'danger')
        except SQLAlchemyError as e:
            db.session.rollback()
            app.logger.error(f"DB error during login for user {username}: {e}")
            flash("Erreur base de données lors de la connexion.", "danger")
        except Exception as e:
            db.session.rollback()
            app.logger.error(f"Unexpected error during login for user {username}: {e}", exc_info=True)
            flash("Erreur interne du serveur.", "danger")
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    try:
        add_activity('deconnexion', f'Déconnexion de {current_user.username}', user=current_user)
        logout_user()
        flash('Vous avez été déconnecté avec succès.', 'success')
    except Exception as e:
        app.logger.error(f"Error during logout for user {current_user.username}: {e}", exc_info=True)
        flash("Erreur lors de la déconnexion.", "warning")
    return redirect(url_for('login'))

@app.route('/generer_invitation/<int:inscription_id>')
@login_required
@db_operation_with_retry(max_retries=2)
def generer_invitation(inscription_id):
    app.logger.info(f"Tentative de génération ICS pour Inscription ID: {inscription_id}")
    try:
        inscription = db.session.query(Inscription).options(
            joinedload(Inscription.participant),
            joinedload(Inscription.session).joinedload(Session.theme),
            joinedload(Inscription.session).joinedload(Session.salle) # S'assurer que la salle est chargée
        ).get(inscription_id)

        if not inscription:
            flash("Inscription non trouvée.", "danger")
            return redirect(request.referrer or url_for('dashboard'))

        if inscription.statut != 'confirmé':
            flash("L'invitation ne peut être générée que pour une inscription confirmée.", "warning")
            return redirect(request.referrer or url_for('dashboard'))

        if not inscription.participant or not inscription.session or not inscription.session.theme:
             flash("Données participant ou session manquantes pour générer l'invitation.", "danger")
             app.logger.error(f"ICS Gen Error: Missing data for Inscription ID {inscription_id}")
             return redirect(request.referrer or url_for('dashboard'))

        ics_content = generate_ics(inscription.session, inscription.participant, inscription.session.salle)

        if ics_content is None:
            flash("Erreur lors de la génération du fichier d'invitation.", "danger")
            app.logger.error(f"generate_ics returned None for Inscription ID {inscription_id}")
            return redirect(request.referrer or url_for('dashboard'))

        response = make_response(ics_content)
        filename = f"formation_{inscription.session.theme.nom.replace(' ', '_')}_{inscription.session.date.strftime('%Y%m%d')}.ics"
        response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
        response.headers['Content-Type'] = 'text/calendar; charset=utf-8'
        
        add_activity('telecharger_invitation', f'Téléchargement invitation: {inscription.participant.prenom} {inscription.participant.nom}', f'Session: {inscription.session.theme.nom}', user=current_user)
        app.logger.info(f"ICS généré et envoyé pour Inscription ID: {inscription_id}")
        return response

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"Erreur DB lors de la génération ICS pour Inscription ID {inscription_id}: {e}", exc_info=True)
        flash("Erreur base de données lors de la génération de l'invitation.", "danger")
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Erreur inattendue lors de la génération ICS pour Inscription ID {inscription_id}: {e}", exc_info=True)
        flash("Une erreur interne est survenue lors de la génération de l'invitation.", "danger")
    
    return redirect(request.referrer or url_for('dashboard'))

# --- Main Application Routes ---
@app.route('/dashboard')
@db_operation_with_retry(max_retries=3)
def dashboard():
    app.logger.info(f"User '{current_user.username if current_user.is_authenticated else 'Anonymous'}' accessing /dashboard.")
    try:
        # Données générales pour les modaux et listes déroulantes
        themes_for_dropdown = get_all_themes() # Cache optimisé
        services_for_modal_dropdown = get_all_services_with_participants() # Cache optimisé
        salles_for_modal_dropdown = get_all_salles() # Cache optimisé
        participants_for_modal_dropdown = get_all_participants_with_service() # Cache optimisé

        # Charger les sessions avec toutes les relations nécessaires pour la table et les calculs
        sessions_query = Session.query.options(
            selectinload(Session.theme),
            selectinload(Session.salle),
            selectinload(Session.inscriptions).selectinload(Inscription.participant).selectinload(Participant.service),
            selectinload(Session.liste_attente).selectinload(ListeAttente.participant).selectinload(Participant.service)
        ).order_by(Session.date, Session.heure_debut)
        sessions_from_db = sessions_query.all()
        app.logger.debug(f"Fetched {len(sessions_from_db)} sessions with eager loading for dashboard.")

        # Validations en attente pour l'utilisateur actuel (admin/responsable)
        pending_validations_list = []
        if current_user.is_authenticated and (current_user.role == 'admin' or current_user.role == 'responsable'):
            query_pending = Inscription.query.options(
                joinedload(Inscription.participant).selectinload(Participant.service),
                joinedload(Inscription.session).selectinload(Session.theme)
            ).filter(Inscription.statut == 'en attente')
            if current_user.role == 'responsable' and current_user.service_id:
                query_pending = query_pending.join(Inscription.participant).filter(Participant.service_id == current_user.service_id)
            pending_validations_list = query_pending.order_by(Inscription.date_inscription.asc()).all()
            app.logger.debug(f"Fetched {len(pending_validations_list)} pending validation(s) for user '{current_user.username}'.")

        # Initialisation des compteurs globaux et de la liste des sessions pour le template
total_inscriptions_confirmees_global = 0
    total_en_attente_global_pending = 0  # Compteur pour les inscriptions en attente
    total_sessions_completes_global = 0
    sessions_data_for_template = []

for s_obj in sessions_from_db:
    try:
        # Utiliser les listes préchargées par selectinload
        inscrits_confirmes_list = [i for i in s_obj.inscriptions if i.statut == 'confirmé']
        pending_inscriptions_list = [i for i in s_obj.inscriptions if i.statut == 'en attente']
        liste_attente_entries_list = s_obj.liste_attente # C'est déjà une liste d'objets

        inscrits_count = len(inscrits_confirmes_list)
        attente_count = len(liste_attente_entries_list)
        pending_valid_count = len(pending_inscriptions_list)
        
        # Utiliser la méthode get_places_restantes qui peut utiliser le compte précalculé
        places_rest = s_obj.get_places_restantes(confirmed_count=inscrits_count)

        # Mettre à jour les totaux globaux
        total_inscriptions_confirmees_global += inscrits_count
        total_en_attente_global_pending += pending_valid_count  # Modifié: compte les inscriptions en attente de validation
        if places_rest == 0:
            total_sessions_completes_global += 1
        
        # Préparer les données pour la table des sessions dans le template
        sessions_data_for_template.append({
            'obj': s_obj,
            'places_restantes': places_rest,
            'inscrits_confirmes_count': inscrits_count,
            'liste_attente_count': attente_count,
            'pending_count': pending_valid_count,
            'loaded_inscrits_confirmes': sorted(inscrits_confirmes_list, key=lambda i: i.date_inscription, reverse=True),
            'loaded_pending_inscriptions': sorted(pending_inscriptions_list, key=lambda i: i.date_inscription, reverse=True),
            'loaded_liste_attente': sorted(liste_attente_entries_list, key=lambda la: la.position)
        })
            except Exception as sess_error:
                app.logger.error(f"Error processing session {s_obj.id} for dashboard: {sess_error}", exc_info=True)
                # Ajouter une entrée d'erreur pour ne pas casser la boucle
                sessions_data_for_template.append({
                    'obj': s_obj, 'places_restantes': 0, 'inscrits_confirmes_count': 0,
                    'liste_attente_count': 0, 'pending_count': 0, 'error': True,
                    'loaded_inscrits_confirmes': [], 'loaded_pending_inscriptions': [], 'loaded_liste_attente': []
                })
        
        # --- Préparation des données pour les graphiques statiques ---
        # 1. Répartition des inscriptions par thème
        theme_inscription_counts = {}
        for s_data_item in sessions_data_for_template: # Utiliser les données déjà traitées pour les sessions
            if not s_data_item.get('error'): # Ignorer les sessions en erreur
                theme_name = s_data_item['obj'].theme.nom if s_data_item['obj'].theme else "Non défini"
                theme_inscription_counts[theme_name] = theme_inscription_counts.get(theme_name, 0) + s_data_item['inscrits_confirmes_count']
        
        sorted_themes_for_chart = sorted(theme_inscription_counts.items(), key=lambda item: item[1], reverse=True)

        # 2. Distribution par service (utilise participants_for_modal_dropdown qui contient déjà les objets Participant)
        service_participant_counts = {}
        if participants_for_modal_dropdown:
            for p_obj in participants_for_modal_dropdown: # p_obj est un objet Participant
                service_name = p_obj.service.nom if p_obj.service else "Non défini"
                service_color = p_obj.service.couleur if p_obj.service and p_obj.service.couleur else '#6c757d'
                if service_name not in service_participant_counts:
                    service_participant_counts[service_name] = {'count': 0, 'color': service_color}
                service_participant_counts[service_name]['count'] += 1
        
        sorted_services_for_chart = sorted(service_participant_counts.items(), key=lambda item: item[1]['count'], reverse=True)
        
        # Récupérer les activités récentes pour le rendu initial
        activites_recentes_initiales = get_recent_activities(limit=5) # Utilise la fonction mise en cache

        app.logger.debug(f"Dashboard Render Data: TotalInscrits={total_inscriptions_confirmees_global}, TotalAttente={total_en_attente_global_liste_attente}, SessionsCompletes={total_sessions_completes_global}, TotalSessions={len(sessions_from_db)}")

        return render_template('dashboard.html',
                      themes=themes_for_dropdown,
                      sessions_data=sessions_data_for_template,
                      services=services_for_modal_dropdown,
                      participants=participants_for_modal_dropdown,
                      salles=salles_for_modal_dropdown,
                      total_inscriptions=total_inscriptions_confirmees_global,
                      total_en_attente=total_en_attente_global_pending,  # Modifié: utilise la nouvelle variable
                      total_sessions_completes=total_sessions_completes_global,
                      pending_validations=pending_validations_list,
                      Inscription=Inscription,
                      ListeAttente=ListeAttente,
                      chart_theme_data=sorted_themes_for_chart,
                      chart_service_data=sorted_services_for_chart,
                      initial_activities=activites_recentes_initiales,
                      themes_config=app.config.get('THEMES_DATA_FOR_CHART', {}),
                      services_config=app.config.get('SERVICES_DATA_FOR_CHART', {})
                      )

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading dashboard: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement du tableau de bord.", "danger")
        return render_template('error.html', error_message="Erreur base de données."), 500
    except BuildError as be:
        db.session.rollback()
        app.logger.error(f"BuildError in dashboard route (likely url_for in template): {be}", exc_info=True)
        flash(f"Erreur de configuration de lien : {be}", "danger")
        return render_template('error.html', error_message=f"Erreur de lien interne: {be}"), 500
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error in dashboard route: {e}", exc_info=True)
        flash("Une erreur interne est survenue.", "danger")
        return render_template('error.html', error_message="Erreur interne du serveur."), 500

@app.route('/services')
@db_operation_with_retry(max_retries=3)
def services():
    try:
        services_list = get_all_services_with_participants() # Déjà optimisé avec selectinload
        services_data = []

        # Pré-calculer les comptes d'inscriptions confirmées pour tous les participants concernés
        all_participant_ids = [p.id for service_obj in services_list for p in service_obj.participants]
        confirmed_counts_by_participant = {}
        if all_participant_ids:
            confirmed_q = db.session.query(
                Inscription.participant_id, func.count(Inscription.id)
            ).filter(
                Inscription.participant_id.in_(all_participant_ids), 
                Inscription.statut == 'confirmé'
            ).group_by(Inscription.participant_id).all()
            confirmed_counts_by_participant = dict(confirmed_q)

        for s_obj in services_list:
            participants_detailed_list = []
            # Trier les participants du service
            sorted_participants = sorted(s_obj.participants, key=lambda x: (x.prenom or '', x.nom or ''))
            for p in sorted_participants:
                confirmed_count = confirmed_counts_by_participant.get(p.id, 0)
                participants_detailed_list.append({'obj': p, 'confirmed_count': confirmed_count})
            
            services_data.append({
                'obj': s_obj, 
                'participant_count': len(s_obj.participants), 
                'participants_detailed': participants_detailed_list
            })
        return render_template('services.html', services_data=services_data)
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading services page: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement des services.", "danger")
        return redirect(url_for('dashboard'))
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error loading services page: {e}", exc_info=True)
        flash("Une erreur interne est survenue lors du chargement des services.", "danger")
        return redirect(url_for('dashboard'))

@app.route('/sessions')
@db_operation_with_retry(max_retries=3)
def sessions():
    app.logger.info(f"User '{current_user.username if current_user.is_authenticated else 'Anonymous'}' accessing /sessions.")
    try:
        query = Session.query.options(
            selectinload(Session.theme), 
            selectinload(Session.salle), 
            selectinload(Session.inscriptions).selectinload(Inscription.participant).selectinload(Participant.service), 
            selectinload(Session.liste_attente).selectinload(ListeAttente.participant).selectinload(Participant.service)
        ).order_by(Session.date, Session.heure_debut)

        theme_id_filter = request.args.get('theme')
        date_str_filter = request.args.get('date')
        places_filter = request.args.get('places')

        if theme_id_filter:
            try:
                query = query.filter(Session.theme_id == int(theme_id_filter))
            except ValueError:
                flash('ID de thème invalide.', 'warning')
        
        if date_str_filter:
            try:
                date_obj = date.fromisoformat(date_str_filter)
                query = query.filter(Session.date >= date_obj)
            except ValueError:
                flash('Format de date invalide (AAAA-MM-JJ).', 'warning')

        all_sessions_from_db = query.all()
        app.logger.info(f"Fetched {len(all_sessions_from_db)} sessions from DB after base filters.")
        
        sessions_final_data = []
        for s_obj in all_sessions_from_db:
            inscrits_confirmes_list = [i for i in s_obj.inscriptions if i.statut == 'confirmé']
            pending_inscriptions_list = [i for i in s_obj.inscriptions if i.statut == 'en attente']
            liste_attente_entries_list = s_obj.liste_attente

            inscrits_count = len(inscrits_confirmes_list)
            attente_count = len(liste_attente_entries_list)
            pending_count = len(pending_inscriptions_list)
            
            places_rest = s_obj.get_places_restantes(confirmed_count=inscrits_count)

            if places_filter == 'available' and places_rest <= 0:
                continue
            if places_filter == 'full' and places_rest > 0:
                continue
            
            sessions_final_data.append({
                'obj': s_obj, 
                'places_restantes': places_rest, 
                'inscrits_confirmes_count': inscrits_count, 
                'liste_attente_count': attente_count, 
                'pending_count': pending_count,
                'loaded_inscrits_confirmes': sorted(inscrits_confirmes_list, key=lambda i: i.date_inscription, reverse=True),
                'loaded_pending_inscriptions': sorted(pending_inscriptions_list, key=lambda i: i.date_inscription, reverse=True),
                'loaded_liste_attente': sorted(liste_attente_entries_list, key=lambda la: la.position)
            })
        
        app.logger.info(f"Prepared {len(sessions_final_data)} sessions for template after all filters.")

        themes_for_filter = get_all_themes()
        participants_for_modal = get_all_participants_with_service()
        services_for_modal = get_all_services_with_participants()
        
        salles_for_modal = []
        if current_user.is_authenticated and current_user.role == 'admin':
            salles_for_modal = get_all_salles()

        return render_template('sessions.html', 
                              sessions_data=sessions_final_data, 
                              themes=themes_for_filter, 
                              participants=participants_for_modal, 
                              services=services_for_modal, 
                              salles=salles_for_modal,
                              request_args=request.args,
                              Inscription=Inscription,
                              ListeAttente=ListeAttente)

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error in /sessions route: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement des sessions.", "danger")
        return redirect(url_for('dashboard'))
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error in /sessions route: {e}", exc_info=True)
        flash("Une erreur interne est survenue lors du chargement des sessions.", "danger")
        return redirect(url_for('dashboard'))

@app.route('/inscription', methods=['POST'])
@db_operation_with_retry(max_retries=3)
def inscription():
    from_page_value = request.form.get('from_page', 'dashboard')
    valid_from_pages = ['admin', 'services', 'participants_page', 'sessions', 'dashboard']
    redirect_url = url_for(from_page_value) if from_page_value in valid_from_pages else url_for('dashboard')
    
    app.logger.info(f"--- Route /inscription POST ---")
    app.logger.debug(f"Form data: {request.form}")
    try:
        participant_id_from_form = request.form.get('participant_id', type=int)
        session_id_from_form = request.form.get('session_id', type=int)
        app.logger.info(f"Inscription attempt: P_ID={participant_id_from_form}, S_ID={session_id_from_form}")

        if not participant_id_from_form or not session_id_from_form:
            flash('Données d\'inscription cruciales manquantes.', 'danger')
            return redirect(redirect_url)

        participant_a_inscrire = db.session.get(Participant, participant_id_from_form)
        session_obj = db.session.get(Session, session_id_from_form)

        if not participant_a_inscrire:
            flash(f'Participant introuvable.', 'danger')
            return redirect(redirect_url)
        if not session_obj:
            flash(f'Session introuvable.', 'danger')
            return redirect(redirect_url)
        
        app.logger.info(f"Processing for P: {participant_a_inscrire.prenom} {participant_a_inscrire.nom} (ID:{participant_a_inscrire.id}) to S: {session_obj.theme.nom} (ID:{session_obj.id})")

        # Vérifier inscription active existante
        existing_active_inscription = Inscription.query.filter(
            Inscription.participant_id == participant_a_inscrire.id,
            Inscription.session_id == session_obj.id,
            Inscription.statut.in_(['confirmé', 'en attente'])
        ).first()
        if existing_active_inscription:
            flash(f'{participant_a_inscrire.prenom} {participant_a_inscrire.nom} a déjà une inscription "{existing_active_inscription.statut}" pour cette session.', 'warning')
            return redirect(redirect_url)

        # Vérifier liste d'attente existante
        existing_waitlist = ListeAttente.query.filter_by(participant_id=participant_a_inscrire.id, session_id=session_obj.id).first()
        if existing_waitlist:
            flash(f'{participant_a_inscrire.prenom} {participant_a_inscrire.nom} est déjà en liste d\'attente (position {existing_waitlist.position}) pour cette session.', 'warning')
            return redirect(redirect_url)

        # Vérifier inscription inactive existante (pour réactivation)
        existing_inactive_inscription = Inscription.query.filter(
            Inscription.participant_id == participant_a_inscrire.id,
            Inscription.session_id == session_obj.id,
            Inscription.statut.in_(['refusé', 'annulé'])
        ).first()

        current_confirmed_for_session = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == session_obj.id, Inscription.statut == 'confirmé').scalar() or 0
        places_disponibles = session_obj.get_places_restantes(confirmed_count=current_confirmed_for_session)
        app.logger.debug(f"S_ID={session_obj.id}: Places disponibles calculées = {places_disponibles} (Confirmés actuels: {current_confirmed_for_session})")

        if places_disponibles <= 0:
            app.logger.info(f"Session S_ID={session_obj.id} complète. Redirection vers liste d'attente pour P_ID={participant_a_inscrire.id}.")
            flash(f'La session "{session_obj.theme.nom}" est complète. Une inscription en liste d\'attente est nécessaire.', 'info')
            return redirect(url_for('liste_attente', session_id=session_obj.id, participant_id=participant_a_inscrire.id, from_page=from_page_value))

        if existing_inactive_inscription:
            app.logger.info(f"Réactivation de l'inscription inactive (statut: {existing_inactive_inscription.statut}) pour P_ID={participant_a_inscrire.id} à S_ID={session_obj.id}.")
            existing_inactive_inscription.statut = 'en attente'
            existing_inactive_inscription.date_inscription = datetime.now(UTC)
            existing_inactive_inscription.validation_responsable = False # Réinitialiser la validation
            db.session.add(existing_inactive_inscription)
            flash_message = f'Votre précédente inscription ({existing_inactive_inscription.statut}) pour "{participant_a_inscrire.prenom} {participant_a_inscrire.nom}" à la session "{session_obj.theme.nom}" a été réactivée et est maintenant en attente de validation.'
            activity_type = 'reinscription'
            activity_desc = f'Réactivation inscription: {participant_a_inscrire.prenom} {participant_a_inscrire.nom}'
        else:
            app.logger.info(f"Création d'une nouvelle inscription 'en attente' pour P_ID={participant_a_inscrire.id} à S_ID={session_obj.id}.")
            new_inscription = Inscription(participant_id=participant_a_inscrire.id, session_id=session_obj.id, statut='en attente')
            db.session.add(new_inscription)
            flash_message = f'Votre demande d\'inscription pour "{participant_a_inscrire.prenom} {participant_a_inscrire.nom}" à la session "{session_obj.theme.nom}" a été enregistrée et est en attente de validation.'
            activity_type = 'inscription'
            activity_desc = f'Demande inscription: {participant_a_inscrire.prenom} {participant_a_inscrire.nom}'
        
        db.session.commit()
        cache.delete(f'session_counts_{session_obj.id}') # Invalider le cache pour cette session
        app.logger.info(f"Cache invalidé pour session_counts_{session_obj.id} (inscription/réactivation).")
        
        add_activity(activity_type, activity_desc, f'Session: {session_obj.theme.nom} ({session_obj.formatage_date})', user=current_user if current_user.is_authenticated else None)
        socketio.emit('inscription_nouvelle', {'session_id': session_obj.id, 'participant_id': participant_a_inscrire.id, 'statut': 'en attente'}, room='general')
        flash(flash_message, 'success')

    except IntegrityError as ie:
        db.session.rollback()
        flash('Erreur d\'intégrité : Impossible de traiter votre demande. Conflit de données possible.', 'danger')
        app.logger.error(f"Inscription: IntegrityError - {ie}", exc_info=True)
    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de la tentative d\'inscription.', 'danger')
        app.logger.error(f"Inscription: SQLAlchemyError - {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue lors de la tentative d\'inscription.', 'danger')
        app.logger.error(f"Inscription: Unexpected Error - {e}", exc_info=True)
    
    return redirect(redirect_url)

@app.route('/liste_attente', methods=['GET', 'POST'])
@db_operation_with_retry(max_retries=3)
def liste_attente():
    participant_id = request.args.get('participant_id', type=int) or request.form.get('participant_id', type=int)
    session_id = request.args.get('session_id', type=int) or request.form.get('session_id', type=int)
    redirect_url = request.referrer or url_for('dashboard')

    if not participant_id or not session_id:
        flash('Informations participant/session manquantes.', 'danger')
        return redirect(redirect_url)
    try:
        participant = db.session.get(Participant, participant_id)
        session_obj = db.session.get(Session, session_id)

        if not participant or not session_obj:
            flash('Participant ou session introuvable.', 'danger')
            return redirect(redirect_url)

        # Vérifier si déjà inscrit ou en liste d'attente
        if (ListeAttente.query.filter_by(participant_id=participant_id, session_id=session_id).first() or
            Inscription.query.filter_by(participant_id=participant_id, session_id=session_id, statut='confirmé').first() or
            Inscription.query.filter_by(participant_id=participant_id, session_id=session_id, statut='en attente').first()):
            flash(f"{participant.prenom} {participant.nom} est déjà inscrit(e) ou en liste d'attente.", 'warning')
            return redirect(redirect_url)

        # Vérifier s'il reste des places (au cas où la situation a changé)
        if session_obj.get_places_restantes() > 0:
            flash(f"Bonne nouvelle ! Il reste {session_obj.get_places_restantes()} place(s) pour cette session. Vous pouvez vous inscrire directement.", 'info')
            return redirect(url_for('sessions')) # Ou vers la page d'inscription de cette session

        if request.method == 'POST':
            position = db.session.query(func.count(ListeAttente.id)).filter(ListeAttente.session_id == session_id).scalar() + 1
            attente = ListeAttente(participant_id=participant_id, session_id=session_id, position=position)
            db.session.add(attente)
            db.session.commit()
            cache.delete(f'session_counts_{session_id}') # Invalider le cache pour cette session

            add_activity('liste_attente', f'Ajout liste attente: {participant.prenom} {participant.nom}', f'Session: {session_obj.theme.nom} ({session_obj.formatage_date}) - Position: {position}', user=current_user)
            socketio.emit('liste_attente_nouvelle', {'session_id': session_id, 'participant_id': participant.id, 'position': position, 'total_session_attente': position}, room='general')
            flash(f'Vous avez été ajouté(e) à la liste d\'attente en position {position}.', 'success')
            return redirect(url_for('dashboard'))
            
    except IntegrityError: # Devrait être attrapé par la vérification ci-dessus, mais au cas où
        db.session.rollback()
        flash('Erreur: Vous êtes déjà en liste d\'attente pour cette session.', 'danger')
    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de l\'ajout à la liste d\'attente.', 'danger')
        app.logger.error(f"SQLAlchemyError during waitlist add: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Unexpected error during waitlist add: {e}", exc_info=True)

    if request.method == 'GET': # Afficher la page de confirmation pour la liste d'attente
        return render_template('liste_attente.html', participant=participant, session=session_obj)
    else: # En cas d'erreur POST non gérée, rediriger
        return redirect(redirect_url)

@app.route('/validation_inscription/<int:inscription_id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def validation_inscription(inscription_id):
    redirect_url = request.referrer or url_for('dashboard')
    try:
        inscription = Inscription.query.options(
            joinedload(Inscription.participant).joinedload(Participant.service),
            joinedload(Inscription.session).joinedload(Session.theme)
        ).get(inscription_id)

        if not inscription:
            flash('Inscription introuvable.', 'danger')
            return redirect(redirect_url)

        is_admin = current_user.role == 'admin'
        is_responsable = (current_user.role == 'responsable' and 
                          inscription.participant and 
                          inscription.participant.service and 
                          current_user.service_id == inscription.participant.service_id)

        if not (is_admin or is_responsable):
            flash('Action non autorisée.', 'danger')
            return redirect(redirect_url)

        action = request.form.get('action')
        participant_name = f"{inscription.participant.prenom} {inscription.participant.nom}" if inscription.participant else "Inconnu"
        session_info = f"Session: {inscription.session.theme.nom} ({inscription.session.formatage_date})" if inscription.session and inscription.session.theme else "Session inconnue"
        session_id = inscription.session_id # Pour invalider le cache

        if action == 'valider' and inscription.statut == 'en attente':
            if inscription.session.get_places_restantes() <= 0:
                flash("Impossible de valider : la session est complète.", "warning")
                return redirect(redirect_url)
            inscription.statut = 'confirmé'
            inscription.validation_responsable = True
            db.session.commit()
            cache.delete(f'session_counts_{session_id}')
            add_activity('validation', f'Validation inscription: {participant_name}', session_info, user=current_user)
            flash('Inscription validée avec succès.', 'success')
            socketio.emit('inscription_validee', {'inscription_id': inscription.id, 'session_id': session_id, 'participant_id': inscription.participant_id, 'new_status': 'confirmé'}, room='general')
        elif action == 'refuser' and inscription.statut == 'en attente':
            inscription.statut = 'refusé'
            db.session.commit()
            add_activity('refus', f'Refus inscription: {participant_name}', session_info, user=current_user)
            flash('Inscription refusée.', 'warning')
            socketio.emit('inscription_refusee', {'inscription_id': inscription.id, 'session_id': session_id, 'participant_id': inscription.participant_id, 'new_status': 'refusé'}, room='general')
        elif action == 'annuler' and inscription.statut == 'confirmé':
            inscription.statut = 'annulé'
            db.session.commit()
            cache.delete(f'session_counts_{session_id}')
            add_activity('annulation', f'Annulation inscription: {participant_name}', session_info, user=current_user)
            flash('Inscription annulée avec succès.', 'success')
            check_waitlist(session_id) # Vérifier si une place se libère pour la liste d'attente
            socketio.emit('inscription_annulee', {'inscription_id': inscription.id, 'session_id': session_id, 'participant_id': inscription.participant_id, 'new_status': 'annulé'}, room='general')
        else:
            flash(f"Action '{action}' invalide ou statut incorrect.", 'warning')

    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de la validation/annulation.', 'danger')
        app.logger.error(f"SQLAlchemyError during inscription validation/cancellation: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Unexpected error during inscription validation/cancellation: {e}", exc_info=True)
    
    return redirect(redirect_url)
        
@app.route('/validation_inscription_ajax', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def validation_inscription_ajax():
    try:
        data = request.get_json()
        inscription_id = data.get('inscription_id')
        action = data.get('action')

        if not inscription_id or not action:
            app.logger.warning("Validation AJAX: données manquantes.")
            return jsonify({'success': False, 'message': 'Données manquantes.'}), 400

        inscription = db.session.get(Inscription, int(inscription_id))
        if not inscription:
            app.logger.warning(f"Validation AJAX: Inscription {inscription_id} introuvable.")
            return jsonify({'success': False, 'message': 'Inscription introuvable.'}), 404

        participant = inscription.participant
        session_obj = inscription.session

        is_admin = current_user.role == 'admin'
        is_responsable = (current_user.role == 'responsable' and 
                          participant and participant.service and 
                          current_user.service_id == participant.service_id)

        if not (is_admin or is_responsable):
            app.logger.warning(f"Validation AJAX: User {current_user.username} non autorisé pour inscription {inscription_id}.")
            return jsonify({'success': False, 'message': 'Action non autorisée.'}), 403

        original_status = inscription.statut
        message = ""

        if action == 'valider' and original_status == 'en attente':
            if session_obj.get_places_restantes() <= 0:
                app.logger.info(f"Validation AJAX: Session {session_obj.id} complète.")
                return jsonify({'success': False, 'message': 'Impossible de valider : la session est complète.'})
            inscription.statut = 'confirmé'
            inscription.validation_responsable = True
            message = 'Inscription validée avec succès.'
            add_activity('validation', f'Validation AJAX: {participant.prenom} {participant.nom}', f'Session: {session_obj.theme.nom}', user=current_user)
            cache.delete(f'session_counts_{session_obj.id}')
            socketio.emit('inscription_validee', {'inscription_id': inscription.id, 'session_id': session_obj.id, 'participant_id': participant.id, 'new_status': 'confirmé'}, room='general')
        elif action == 'refuser' and original_status == 'en attente':
            inscription.statut = 'refusé'
            message = 'Inscription refusée.'
            add_activity('refus', f'Refus AJAX: {participant.prenom} {participant.nom}', f'Session: {session_obj.theme.nom}', user=current_user)
            socketio.emit('inscription_refusee', {'inscription_id': inscription.id, 'session_id': session_obj.id, 'participant_id': participant.id, 'new_status': 'refusé'}, room='general')
        else:
            app.logger.warning(f"Validation AJAX: Action '{action}' invalide ou statut '{original_status}' incorrect.")
            return jsonify({'success': False, 'message': f"Action '{action}' invalide ou statut incorrect."})

        db.session.commit()
        app.logger.info(f"Validation AJAX: {message} pour inscription {inscription_id} par user {current_user.username}.")
        return jsonify({'success': True, 'message': message, 'new_status': inscription.statut})

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"Validation AJAX: Erreur DB - {e}", exc_info=True)
        return jsonify({'success': False, 'message': 'Erreur de base de données.'}), 500
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Validation AJAX: Erreur inattendue - {e}", exc_info=True)
        return jsonify({'success': False, 'message': 'Erreur interne du serveur.'}), 500

# --- Document Routes ---
@app.route('/documents')
@db_operation_with_retry(max_retries=3)
def documents():
    try:
        themes_with_docs_query = Theme.query.options(
            selectinload(Theme.documents).joinedload(Document.uploader)
        ).order_by(Theme.nom)
        
        # Ajouter une section pour les documents sans thème (theme_id IS NULL)
        general_docs = Document.query.filter(Document.theme_id.is_(None)).options(
            joinedload(Document.uploader)
        ).order_by(Document.original_filename).all()

        themes_with_docs_list = themes_with_docs_query.all()
        
        # Créer une structure pour les documents généraux si nécessaire
        # On peut les ajouter comme un "thème" spécial ou les traiter séparément dans le template
        # Pour simplifier, on peut les passer comme une liste séparée.
        # Ou, si on veut les intégrer dans la boucle des thèmes, on crée un objet factice:
        
        # Structure pour le template:
        # themes_with_docs: liste d'objets Theme (avec leurs documents)
        # general_docs_list: liste d'objets Document (ceux sans thème)

        themes_for_upload_form = []
        if current_user.is_authenticated and current_user.role == 'admin':
            themes_for_upload_form = get_all_themes()

        show_admin_features = current_user.is_authenticated and current_user.role == 'admin'

        return render_template('documents.html', 
                               themes_with_docs=themes_with_docs_list,
                               general_docs_list=general_docs, # Passer les documents généraux
                               themes_for_upload=themes_for_upload_form,
                               show_admin_features=show_admin_features,
                               ALLOWED_EXTENSIONS=ALLOWED_EXTENSIONS)
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading documents page: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement des documents.", "danger")
        return redirect(url_for('dashboard'))
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error loading documents page: {e}", exc_info=True)
        flash("Une erreur interne est survenue.", "danger")
        return redirect(url_for('dashboard'))

@app.route('/download_document/<path:filename>')
@db_operation_with_retry(max_retries=2)
def download_document(filename):
    try:
        safe_filename = secure_filename(filename)
        if safe_filename != filename:
            app.logger.warning(f"Tentative de téléchargement avec nom de fichier potentiellement dangereux: {filename}")
            flash("Nom de fichier invalide.", "danger")
            return redirect(url_for('documents'))

        doc = Document.query.filter_by(filename=safe_filename).first()
        if not doc:
            app.logger.warning(f"Tentative de téléchargement d'un document inexistant: {safe_filename}")
            flash("Document non trouvé.", "danger")
            return redirect(url_for('documents'))

        app.logger.info(f"Téléchargement du document '{doc.original_filename}' (fichier: {safe_filename}) demandé.")
        return send_from_directory(app.config['UPLOAD_FOLDER'], safe_filename, as_attachment=True, download_name=doc.original_filename)
    
    except FileNotFoundError:
        app.logger.error(f"Fichier non trouvé sur le disque pour le document: {safe_filename}", exc_info=True)
        flash("Erreur : le fichier demandé n'existe plus sur le serveur.", "danger")
        return redirect(url_for('documents'))
    except Exception as e:
        app.logger.error(f"Erreur lors du téléchargement du document {safe_filename}: {e}", exc_info=True)
        flash("Erreur lors du téléchargement du document.", "danger")
        return redirect(url_for('documents'))

# --- Admin Routes ---
@app.route('/admin')
@login_required
@db_operation_with_retry(max_retries=3)
def admin():
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs.', 'danger')
        return redirect(url_for('dashboard'))
    try:
        app.logger.info(f"Admin '{current_user.username}' accessing /admin panel.")
        
        # Utiliser les fonctions mises en cache autant que possible
        themes = get_all_themes()
        services = get_all_services_with_participants()
        participants_list = get_all_participants_with_service() # Renommé pour clarté
        salles = get_all_salles()
        activites_recentes = get_recent_activities(limit=10) # Limite à 10 pour l'affichage

        # Requêtes spécifiques pour les statistiques du panel admin
        total_inscriptions_confirmees = db.session.query(func.count(Inscription.id)).filter(Inscription.statut == 'confirmé').scalar() or 0
        total_en_liste_attente = db.session.query(func.count(ListeAttente.id)).scalar() or 0
        total_sessions_count_db = db.session.query(func.count(Session.id)).scalar() or 0 # Renommé pour éviter conflit

        # Calcul des sessions complètes (plus robuste)
        total_sessions_completes_db = 0
        all_sessions_for_stats = Session.query.options(selectinload(Session.inscriptions)).all()
        if all_sessions_for_stats:
            for sess_stat in all_sessions_for_stats:
                confirmed_count = sum(1 for insc in sess_stat.inscriptions if insc.statut == 'confirmé')
                if sess_stat.max_participants is not None and confirmed_count >= sess_stat.max_participants:
                    total_sessions_completes_db += 1
        
        # Compte des sessions par thème
        theme_session_counts = {theme.id: len(theme.sessions) for theme in themes} # Utilise les sessions préchargées par get_all_themes

        # Documents existants
        existing_documents = Document.query.options(
            joinedload(Document.theme), 
            joinedload(Document.uploader)
        ).order_by(Document.upload_date.desc()).all() # Pas besoin de limiter ici, le template le fera

        app.logger.debug(f"Admin panel data: Themes={len(themes)}, Services={len(services)}, Participants={len(participants_list)}, Salles={len(salles)}")

        return render_template('admin.html',
                              themes=themes,
                              theme_session_counts=theme_session_counts,
                              # sessions=all_sessions_for_stats, # Pas directement utilisé dans admin.html, mais total_sessions_count_db l'est
                              services=services,
                              participants=participants_list, # Passer la liste des objets Participant
                              salles=salles,
                              total_inscriptions=total_inscriptions_confirmees,
                              total_en_attente=total_en_liste_attente,
                              total_sessions_completes=total_sessions_completes_db,
                              total_sessions_count=total_sessions_count_db,
                              activites_recentes=activites_recentes,
                              existing_documents=existing_documents,
                              ListeAttente=ListeAttente # Si utilisé pour type hinting dans le template
                              )
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading admin page: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement de la page admin.", "danger")
        return render_template('error.html', error_message="Erreur base de données."), 500
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error loading admin page: {e}", exc_info=True)
        flash("Une erreur interne est survenue.", "danger")
        return render_template('error.html', error_message="Erreur interne du serveur."), 500

@app.route('/admin/upload_document', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def upload_document():
    if current_user.role != 'admin':
        flash("Action réservée aux administrateurs.", "danger")
        return redirect(url_for('dashboard'))
    
    from_page = request.form.get('from_page', 'admin')
    redirect_url = url_for('admin')
    if from_page == 'documents':
        redirect_url = url_for('documents')
    
    try:
        if 'document_file' not in request.files:
            flash('Aucun fichier sélectionné.', 'warning')
            return redirect(redirect_url)
        
        file = request.files['document_file']
        theme_id_str = request.form.get('theme_id')
        description = request.form.get('description', '').strip()

        if file.filename == '':
            flash('Aucun fichier sélectionné.', 'warning')
            return redirect(redirect_url)

        if file and allowed_file(file.filename):
            original_filename = file.filename
            filename_base = secure_filename(original_filename) 
            filename_ext = ''
            if '.' in filename_base:
                filename_base, filename_ext = filename_base.rsplit('.', 1)
                filename_ext = '.' + filename_ext.lower()

            unique_id = str(int(time.time())) + "_" + str(random.randint(1000, 9999))
            filename = f"{filename_base}_{unique_id}{filename_ext}"

            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path)
            app.logger.info(f"Fichier '{original_filename}' uploadé comme '{filename}' par {current_user.username}.")

            theme_id = int(theme_id_str) if theme_id_str and theme_id_str.isdigit() else None
            file_type_from_ext = filename_ext[1:] if filename_ext else None

            new_doc = Document(
                filename=filename, 
                original_filename=original_filename, 
                description=description or None, 
                theme_id=theme_id, 
                uploader_id=current_user.id, 
                file_type=file_type_from_ext
            )
            db.session.add(new_doc)
            db.session.commit()
            
            if theme_id:
                cache.delete_memoized(get_all_themes)
            cache.delete('dashboard_essential_data')

            add_activity('ajout_document', f'Upload: {original_filename}', f'Thème: {new_doc.theme.nom if new_doc.theme else "Général"}', user=current_user)
            flash('Document uploadé avec succès.', 'success')
        else:
            flash('Type de fichier non autorisé ou nom de fichier problématique.', 'warning')
            
    except RequestEntityTooLarge:
        flash('Le fichier est trop volumineux (limite: 16MB).', 'danger')
    except SQLAlchemyError as e:
        db.session.rollback()
        flash("Erreur base de données lors de l'upload.", "danger")
        app.logger.error(f"DB error during document upload: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash("Erreur inattendue lors de l'upload.", "danger")
        app.logger.error(f"Unexpected error during document upload: {e}", exc_info=True)
    
    return redirect(redirect_url)

@app.route('/admin/delete_document/<int:doc_id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def delete_document(doc_id):
    if current_user.role != 'admin':
        flash("Action réservée aux administrateurs.", "danger")
        return redirect(url_for('dashboard'))

    from_page = request.form.get('from_page', 'admin')
    redirect_url = url_for('admin')
    if from_page == 'documents':
        redirect_url = url_for('documents')
    
    try:
        doc = db.session.get(Document, doc_id)
        if not doc:
            flash("Document non trouvé.", "warning")
            return redirect(redirect_url)
        
        filename = doc.filename
        original_filename = doc.original_filename
        theme_id_of_doc = doc.theme_id
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                app.logger.info(f"Fichier physique '{filename}' supprimé.")
            except OSError as e:
                app.logger.error(f"Erreur suppression fichier physique {filename}: {e}", exc_info=True)
        else:
            app.logger.warning(f"Fichier physique '{filename}' non trouvé pour suppression (Doc ID: {doc_id}).")
        
        db.session.delete(doc)
        db.session.commit()

        if theme_id_of_doc:
            cache.delete_memoized(get_all_themes)
        cache.delete('dashboard_essential_data')

        add_activity('suppression_document', f'Suppression: {original_filename}', user=current_user)
        flash(f'Document "{original_filename}" supprimé avec succès.', 'success')
    except SQLAlchemyError as e:
        db.session.rollback()
        flash("Erreur base de données lors de la suppression.", "danger")
        app.logger.error(f"DB error during document delete (ID: {doc_id}): {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash("Erreur inattendue lors de la suppression.", "danger")
        app.logger.error(f"Unexpected error during document delete (ID: {doc_id}): {e}", exc_info=True)
    return redirect(redirect_url)
    
@app.route('/api/dashboard_essential')
@db_operation_with_retry(max_retries=2)
def api_dashboard_essential():
    try:
        light_mode = request.args.get('light', '0') == '1'
        cache_key = f'dashboard_essential_data{"_light" if light_mode else ""}'
        
        cached_data = cache.get(cache_key)
        if cached_data and 'participants' in cached_data and cached_data['participants']:
            return jsonify(cached_data)
        elif cached_data:
            cache.delete(cache_key)
            app.logger.debug("API dashboard_essential: Participants missing from cache, re-fetching.")
        
        sessions_data = get_sessions_data()
        participants_data = get_participants_data()
        activites_data = get_activites_data(limit=5)
        
        response_data = {
            'sessions': sessions_data,
            'participants': participants_data,
            'activites': activites_data,
            'timestamp': datetime.now(UTC).timestamp(),
            'light_mode': light_mode,
            'status': 'ok'
        }
        
        cache_timeout = 30 if light_mode else 90
        cache.set(cache_key, response_data, timeout=cache_timeout)
        
        return jsonify(response_data)
        
    except SQLAlchemyError as e:
        handle_db_error(e, "dashboard_essential")
        return jsonify({
            "error": "Database error", "message": "Une erreur de base de données est survenue",
            "status": "error", "timestamp": datetime.now(UTC).timestamp()
        }), 500
    except Exception as e:
        handle_general_error(e, "dashboard_essential")
        return jsonify({
            "error": "Internal server error", "message": "Une erreur interne est survenue",
            "status": "error", "timestamp": datetime.now(UTC).timestamp()
        }), 500

def get_sessions_data():
    sessions_data = []
    sessions_q = Session.query.options(
        joinedload(Session.theme), joinedload(Session.salle)
    ).order_by(Session.date, Session.heure_debut).all()
    
    session_ids = [s.id for s in sessions_q]
    inscrits_counts, attente_counts, pending_counts = {}, {}, {}

    if session_ids:
        inscrits_counts = dict(db.session.query(
            Inscription.session_id, func.count(Inscription.id)
        ).filter(Inscription.session_id.in_(session_ids), Inscription.statut == 'confirmé')
         .group_by(Inscription.session_id).all())
        
        attente_counts = dict(db.session.query(
            ListeAttente.session_id, func.count(ListeAttente.id)
        ).filter(ListeAttente.session_id.in_(session_ids))
         .group_by(ListeAttente.session_id).all())
        
        pending_counts = dict(db.session.query(
            Inscription.session_id, func.count(Inscription.id)
        ).filter(Inscription.session_id.in_(session_ids), Inscription.statut == 'en attente')
         .group_by(Inscription.session_id).all())
    
    for s in sessions_q:
        try:
            inscrits_count = inscrits_counts.get(s.id, 0)
            attente_count = attente_counts.get(s.id, 0)
            pending_count = pending_counts.get(s.id, 0)
            max_participants = int(s.max_participants) if s.max_participants is not None else 10
            places_rest = max(0, max_participants - inscrits_count)
            
            sessions_data.append({
                'id': s.id, 'date': s.formatage_date, 'horaire': s.formatage_horaire,
                'theme': s.theme.nom if s.theme else 'N/A', 'theme_id': s.theme_id,
                'places_restantes': places_rest, 'inscrits': inscrits_count,
                'max_participants': max_participants, 'liste_attente': attente_count,
                'pending_count': pending_count,
                'salle': s.salle.nom if s.salle else None, 'salle_id': s.salle_id
            })
        except Exception as session_error:
            app.logger.error(f"Error processing session {s.id} in dashboard_essential: {session_error}")
            continue
    return sessions_data

def get_participants_data():
    participants_q = Participant.query.options(
        joinedload(Participant.service)
    ).order_by(Participant.nom).all()
    
    participants_data = []
    for p in participants_q:
        try:
            participants_data.append({
                'id': p.id, 'nom': p.nom, 'prenom': p.prenom, 'email': p.email,
                'service': p.service.nom if p.service else 'N/A', 'service_id': p.service_id,
                'service_color': p.service.couleur if p.service else '#6c757d'
            })
        except Exception as e:
            app.logger.error(f"Error processing participant {p.id}: {e}")
            continue
    return participants_data

def get_activites_data(limit=5):
    activites_q = get_recent_activities(limit=limit) # Utilise la fonction mise en cache
    activites_data = []
    for a in activites_q:
        try:
            activites_data.append({
                'id': a.id, 'type': a.type, 'description': a.description,
                'details': a.details, 'date_relative': a.date_relative,
                'date_iso': a.date.isoformat() if a.date else None,
                'user': a.utilisateur.username if a.utilisateur else None
            })
        except Exception as e:
            app.logger.error(f"Error processing activity {a.id}: {e}")
            continue
    return activites_data

def handle_db_error(e, context):
    db.session.rollback()
    app._connection_errors = getattr(app, '_connection_errors', 0) + 1
    app._last_connection_error = datetime.now(UTC)
    app.logger.error(f"API DB Error in {context}: {e}", exc_info=True)

def handle_general_error(e, context):
    try: db.session.rollback() 
    except: pass
    app._connection_errors = getattr(app, '_connection_errors', 0) + 1
    app._last_connection_error = datetime.now(UTC)
    app.logger.error(f"API Unexpected Error in {context}: {e}", exc_info=True)

@app.route('/api/sessions')
@limiter.limit("30 per minute")
@db_operation_with_retry(max_retries=2)
def api_sessions():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        date_filter = request.args.get('date')
        
        cache_key = f'sessions_page_{page}_size_{per_page}_date_{date_filter}'
        cached_result = cache.get(cache_key)
        if cached_result:
            return jsonify(cached_result)

        query = Session.query.options(joinedload(Session.theme), joinedload(Session.salle))
        if date_filter:
            try:
                filter_date = datetime.strptime(date_filter, '%Y-%m-%d').date()
                query = query.filter(Session.date == filter_date)
            except ValueError: pass # Ignorer si format de date invalide

        pagination = query.order_by(Session.date, Session.heure_debut).paginate(page=page, per_page=per_page, error_out=False)
        
        session_ids = [s.id for s in pagination.items]
        confirmed_counts, waitlist_counts = {}, {}
        if session_ids:
            confirmed_counts = dict(db.session.query(
                Inscription.session_id, func.count(Inscription.id)
            ).filter(Inscription.session_id.in_(session_ids), Inscription.statut == 'confirmé')
             .group_by(Inscription.session_id).all())
            
            waitlist_counts = dict(db.session.query(
                ListeAttente.session_id, func.count(ListeAttente.id)
            ).filter(ListeAttente.session_id.in_(session_ids))
             .group_by(ListeAttente.session_id).all())

        result = []
        for s in pagination.items:
            inscrits_count = confirmed_counts.get(s.id, 0)
            attente_count = waitlist_counts.get(s.id, 0)
            places_rest = max(0, s.max_participants - inscrits_count)
            
            # Mettre à jour le cache individuel de la session
            session_cache_key = f'session_counts_{s.id}'
            session_counts_data = {
                'inscrits_confirmes_count': inscrits_count, 
                'liste_attente_count': attente_count, 
                'places_restantes': places_rest
            }
            cache.set(session_cache_key, session_counts_data, timeout=300) # Cache pour 5 mins

            result.append({
                'id': s.id, 
                'date': s.formatage_date if hasattr(s, 'formatage_date') else s.date.strftime('%d/%m/%Y'), 
                'iso_date': s.date.isoformat(), 
                'horaire': s.formatage_horaire if hasattr(s, 'formatage_horaire') else f"{s.heure_debut.strftime('%H:%M')} - {s.heure_fin.strftime('%H:%M')}", 
                'theme': s.theme.nom if s.theme else 'N/A', 
                'theme_id': s.theme_id, 
                'places_restantes': places_rest, 
                'inscrits': inscrits_count, 
                'max_participants': s.max_participants, 
                'liste_attente': attente_count, 
                'salle': s.salle.nom if s.salle else None, 
                'salle_id': s.salle_id
            })
            
        response_data = {
            'items': result, 
            'total': pagination.total, 
            'pages': pagination.pages, 
            'page': pagination.page, 
            'per_page': pagination.per_page
        }
        cache.set(cache_key, response_data, timeout=30) # Cache la page de résultats pour 30s
        return jsonify(response_data)
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"API Error fetching sessions: {e}", exc_info=True)
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"API Unexpected Error fetching sessions: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500
    finally:
        db.session.close() # S'assurer que la session est fermée

@app.route('/api/sessions/<int:session_id>')
@db_operation_with_retry(max_retries=2)
def api_single_session(session_id):
    try:
        session = db.session.get(Session, session_id)
        if not session:
            return jsonify({"error": "Session not found"}), 404

        cache_key = f'session_counts_{session_id}'
        session_counts = cache.get(cache_key)
        if session_counts is None:
            inscrits_count = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == session_id, Inscription.statut == 'confirmé').scalar() or 0
            attente_count = db.session.query(func.count(ListeAttente.id)).filter(ListeAttente.session_id == session_id).scalar() or 0
            pending_count = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == session_id, Inscription.statut == 'en attente').scalar() or 0
            places_rest = max(0, session.max_participants - inscrits_count)
            session_counts = {
                'inscrits_confirmes_count': inscrits_count, 
                'liste_attente_count': attente_count, 
                'pending_count': pending_count, 
                'places_restantes': places_rest
            }
            cache.set(cache_key, session_counts, timeout=60) # Cache pour 1 min
        else:
            # S'assurer que pending_count est présent, sinon le calculer
            if 'pending_count' not in session_counts:
                session_counts['pending_count'] = db.session.query(func.count(Inscription.id)).filter(Inscription.session_id == session_id, Inscription.statut == 'en attente').scalar() or 0
        
        # Charger les détails des inscriptions et de la liste d'attente
        inscrits_details_q = db.session.query(Inscription.id, Participant.prenom, Participant.nom, Inscription.statut)\
            .join(Participant).filter(Inscription.session_id == session_id).all()
        attente_details_q = db.session.query(ListeAttente.id, Participant.prenom, Participant.nom, ListeAttente.position)\
            .join(Participant).filter(ListeAttente.session_id == session_id).order_by(ListeAttente.position).all()

        result = {
            'id': session.id, 
            'date': session.formatage_date, 
            'iso_date': session.date.isoformat(), 
            'horaire': session.formatage_horaire, 
            'theme': session.theme.nom if session.theme else 'N/A', 
            'theme_id': session.theme_id, 
            'places_restantes': session_counts['places_restantes'], 
            'inscrits': session_counts['inscrits_confirmes_count'], 
            'max_participants': session.max_participants, 
            'liste_attente': session_counts['liste_attente_count'], 
            'pending_count': session_counts.get('pending_count', 0), 
            'salle': session.salle.nom if session.salle else None, 
            'salle_id': session.salle_id,
            'inscriptions_details': [{'id': i.id, 'participant': f"{i.prenom} {i.nom}", 'statut': i.statut} for i in inscrits_details_q],
            'liste_attente_details': [{'id': l.id, 'participant': f"{l.prenom} {l.nom}", 'position': l.position} for l in attente_details_q]
        }
        return jsonify(result)
    except SQLAlchemyError as e:
        app.logger.error(f"API Error session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        app.logger.error(f"API Unexpected Error session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

# ==============================================================================
# === Routes participants et activités ===
# ==============================================================================

@app.route('/participants')
@db_operation_with_retry(max_retries=3)
def participants_page():
    app.logger.info(f"Utilisateur '{current_user.username if current_user.is_authenticated else 'Anonymous'}' accède à la page /participants.")
    try:
        # Charger les participants avec toutes les relations nécessaires pour les modales
        participants_list = Participant.query.options(
            joinedload(Participant.service),
            selectinload(Participant.inscriptions).selectinload(Inscription.session).selectinload(Session.theme),
            selectinload(Participant.inscriptions).selectinload(Inscription.session).selectinload(Session.salle),
            selectinload(Participant.liste_attente).selectinload(ListeAttente.session).selectinload(Session.theme),
            selectinload(Participant.liste_attente).selectinload(ListeAttente.session).selectinload(Session.salle)
        ).order_by(Participant.nom, Participant.prenom).all()

        # Récupérer tous les services pour le menu déroulant du modal "Ajouter Participant"
        # et potentiellement pour d'autres usages dans le template.
        services_for_modal = Service.query.order_by(Service.nom).all()
        
        participants_data_for_template = []
        for p in participants_list:
            # Filtrer et trier les inscriptions et listes d'attente en Python
            # après qu SQLAlchemy les ait chargées via les relations.
            
            confirmed_inscriptions = sorted(
                [i for i in p.inscriptions if i.statut == 'confirmé'],
                key=lambda i: i.session.date if i.session and i.session.date else date.min 
            )
            pending_inscriptions = sorted(
                [i for i in p.inscriptions if i.statut == 'en attente'],
                key=lambda i: i.date_inscription, reverse=True
            )
            waitlist_entries = sorted(
                p.liste_attente, # p.liste_attente est déjà la liste des objets ListeAttente
                key=lambda la: la.position
            )

            participants_data_for_template.append({
                'obj': p,
                'inscriptions_count': len(confirmed_inscriptions),
                'attente_count': len(waitlist_entries),
                'pending_count': len(pending_inscriptions),
                'loaded_confirmed_inscriptions': confirmed_inscriptions,
                'loaded_pending_inscriptions': pending_inscriptions,
                'loaded_waitlist': waitlist_entries
            })

        return render_template('participants.html',
                              participants_data=participants_data_for_template,
                              services=services_for_modal)

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"Erreur DB chargement page participants: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement des participants.", "danger")
        return redirect(url_for('dashboard'))
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Erreur inattendue chargement page participants: {e}", exc_info=True)
        flash("Une erreur interne est survenue lors du chargement des participants.", "danger")
        return redirect(url_for('dashboard'))

@app.route('/participant/add', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def add_participant():
    if not (current_user.role == 'admin' or current_user.role == 'responsable'):
         flash("Action non autorisée.", "danger")
         return redirect(request.referrer or url_for('dashboard'))

    nom = request.form.get('nom')
    prenom = request.form.get('prenom')
    email = request.form.get('email')
    service_id = request.form.get('service_id')
    from_page = request.form.get('from_page', 'dashboard')
    redirect_session_id = request.form.get('redirect_session_id', type=int)
    action_after_add = request.form.get('action_after_add')
    
    valid_from_pages = ['dashboard', 'services', 'participants_page', 'admin']
    default_redirect_url = url_for(from_page) if from_page in valid_from_pages else url_for('dashboard')

    if not all([nom, prenom, email, service_id]):
        flash('Tous les champs marqués * sont obligatoires.', 'warning')
        return redirect(default_redirect_url)

    existing_participant = Participant.query.filter(func.lower(Participant.email) == func.lower(email)).first()
    if existing_participant:
        flash(f'Un participant avec l\'email {email} existe déjà.', 'warning')
        return redirect(default_redirect_url)

    try:
        new_participant = Participant(nom=nom, prenom=prenom, email=email, service_id=service_id)
        db.session.add(new_participant)
        db.session.flush() 
        participant_id = new_participant.id
        participant_name = f"{new_participant.prenom} {new_participant.nom}"
        db.session.commit()

        cache.delete_memoized(get_all_participants_with_service)
        cache.delete_memoized(get_all_services_with_participants)
        cache.delete('dashboard_essential_data')

        add_activity('ajout_participant', f'Ajout: {participant_name}', f'Service: {new_participant.service.nom}', user=current_user)
        flash(f'Participant "{participant_name}" ajouté avec succès.', 'success')

        if action_after_add == 'inscription' and redirect_session_id:
            app.logger.info(f"Participant {participant_id} ajouté, tentative d'inscription à la session {redirect_session_id}")
            session_obj = db.session.get(Session, redirect_session_id)
            if not session_obj:
                 flash(f'Session {redirect_session_id} introuvable pour l\'inscription automatique.', 'warning')
            else:
                existing_active = Inscription.query.filter_by(participant_id=participant_id, session_id=redirect_session_id).first()
                if existing_active:
                     flash(f'{participant_name} a déjà une inscription pour cette session.', 'warning')
                elif session_obj.get_places_restantes() <= 0:
                     position = db.session.query(func.count(ListeAttente.id)).filter(ListeAttente.session_id == redirect_session_id).scalar() + 1
                     attente = ListeAttente(participant_id=participant_id, session_id=redirect_session_id, position=position)
                     db.session.add(attente); db.session.commit()
                     add_activity('liste_attente', f'Ajout liste attente (auto): {participant_name}', f'Session: {session_obj.theme.nom} - Pos: {position}', user=current_user)
                     flash(f'{participant_name} ajouté et mis en liste d\'attente (position {position}) car la session est complète.', 'info')
                else:
                     new_inscription = Inscription(participant_id=participant_id, session_id=redirect_session_id, statut='en attente')
                     db.session.add(new_inscription); db.session.commit()
                     add_activity('inscription', f'Demande inscription (auto): {participant_name}', f'Session: {session_obj.theme.nom}', user=current_user)
                     flash(f'{participant_name} ajouté et inscrit (en attente de validation) à la session "{session_obj.theme.nom}".', 'success')
                     socketio.emit('inscription_nouvelle', {'session_id': redirect_session_id, 'participant_id': participant_id, 'statut': 'en attente'}, room='general')
        
        return redirect(default_redirect_url)

    except IntegrityError as e:
        db.session.rollback()
        app.logger.error(f"Erreur d'intégrité ajout participant: {e}", exc_info=True)
        flash('Erreur : Cet email existe peut-être déjà.', 'danger')
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"Erreur DB ajout participant: {e}", exc_info=True)
        flash('Erreur de base de données lors de l\'ajout du participant.', 'danger')
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Erreur inattendue ajout participant: {e}", exc_info=True)
        flash('Une erreur inattendue est survenue.', 'danger')
    return redirect(default_redirect_url)

@app.route('/participant/update/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def update_participant(id):
    participant = db.session.get(Participant, id)
    if not participant:
        flash('Participant introuvable.', 'danger')
        return redirect(url_for('participants_page'))

    is_admin = current_user.role == 'admin'
    is_responsable = (current_user.role == 'responsable' and current_user.service_id == participant.service_id)
    if not (is_admin or is_responsable):
        flash('Action non autorisée.', 'danger')
        return redirect(url_for('participants_page'))

    nom = request.form.get('nom')
    prenom = request.form.get('prenom')
    email = request.form.get('email')
    service_id = request.form.get('service_id')

    if not all([nom, prenom, email, service_id]):
        flash('Tous les champs marqués * sont obligatoires.', 'warning')
        return redirect(request.referrer or url_for('participants_page'))

    if email.lower() != participant.email.lower():
        existing = Participant.query.filter(func.lower(Participant.email) == func.lower(email), Participant.id != id).first()
        if existing:
            flash(f'L\'email {email} est déjà utilisé par un autre participant.', 'warning')
            return redirect(request.referrer or url_for('participants_page'))

    try:
        participant.nom = nom
        participant.prenom = prenom
        participant.email = email
        participant.service_id = service_id
        db.session.commit()
        cache.delete_memoized(get_all_participants_with_service)
        cache.delete_memoized(get_all_services_with_participants)
        cache.delete('dashboard_essential_data')
        add_activity('modification_participant', f'Modif: {participant.prenom} {participant.nom}', user=current_user)
        flash('Participant mis à jour avec succès.', 'success')
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"Erreur DB màj participant {id}: {e}", exc_info=True)
        flash('Erreur de base de données lors de la mise à jour.', 'danger')
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Erreur inattendue màj participant {id}: {e}", exc_info=True)
        flash('Une erreur inattendue est survenue.', 'danger')
    return redirect(url_for('participants_page'))

@app.route('/participant/delete/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def delete_participant(id):
    if current_user.role != 'admin':
        flash('Action réservée aux administrateurs.', 'danger')
        return redirect(url_for('participants_page'))

    participant = db.session.get(Participant, id)
    if not participant:
        flash('Participant introuvable.', 'warning')
        return redirect(url_for('participants_page'))

    participant_name = f"{participant.prenom} {participant.nom}"
    try:
        db.session.delete(participant) # Cascade should handle related Inscription/ListeAttente
        db.session.commit()
        cache.delete_memoized(get_all_participants_with_service)
        cache.delete_memoized(get_all_services_with_participants)
        cache.delete('dashboard_essential_data')
        add_activity('suppression_participant', f'Suppression: {participant_name}', user=current_user)
        flash(f'Participant "{participant_name}" et ses inscriptions/attentes supprimés.', 'success')
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"Erreur DB suppression participant {id}: {e}", exc_info=True)
        flash('Erreur de base de données lors de la suppression.', 'danger')
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Erreur inattendue suppression participant {id}: {e}", exc_info=True)
        flash('Une erreur inattendue est survenue.', 'danger')
    return redirect(url_for('participants_page'))

# Route pour la page du journal d'activités
@app.route('/activites_journal', methods=['GET'])
@login_required
@db_operation_with_retry(max_retries=3)
def activites_journal():
    if current_user.role != 'admin':
        flash("Accès réservé aux administrateurs.", "danger")
        return redirect(url_for('dashboard'))
    
    page = request.args.get('page', 1, type=int)
    per_page = 20 # Nombre d'activités par page
    filter_type = request.args.get('type', None)

    query = Activite.query.options(joinedload(Activite.utilisateur)).order_by(Activite.date.desc())
    
    if filter_type:
        query = query.filter(Activite.type == filter_type)
        
    try:
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        return render_template('activites.html', activites=pagination, Activite=Activite) # Passer Activite pour les types si besoin
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"Erreur DB chargement journal d'activités: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement du journal.", "danger")
        return redirect(url_for('admin'))
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Erreur inattendue chargement journal d'activités: {e}", exc_info=True)
        flash("Une erreur interne est survenue.", "danger")
        return redirect(url_for('admin'))

# Suppression de la route /api/activites dupliquée (celle-ci était la bonne)
# @app.route('/api/activites')
# @db_operation_with_retry(max_retries=2)
# def api_activites():
#     """API pour récupérer les activités récentes au format JSON."""
#     # ... (code de la fonction api_activites) ...

@app.route('/api/salles')
@db_operation_with_retry(max_retries=2)
def api_salles():
    result = []
    try:
        salles = Salle.query.order_by(Salle.nom).all()
        for salle in salles:
             count = Session.query.filter_by(salle_id=salle.id).count()
             result.append({
                 'id': salle.id, 'nom': salle.nom, 'capacite': salle.capacite, 
                 'lieu': salle.lieu, 'description': salle.description, 
                 'sessions_count': count
             })
        return jsonify(result)
    except SQLAlchemyError as e:
        app.logger.error(f"API Error fetching salles: {e}", exc_info=True)
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        app.logger.error(f"API Unexpected Error fetching salles: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/salles')
@login_required
@db_operation_with_retry(max_retries=3)
def salles_page():
    if current_user.role != 'admin':
        flash("Accès réservé aux administrateurs.", "danger")
        return redirect(url_for('dashboard'))

    app.logger.info(f"Admin '{current_user.username}' accède à la page /salles.")
    try:
        salles_list = Salle.query.order_by(Salle.nom).all()
        salles_data_for_template = []
        salle_ids = [s.id for s in salles_list]
        session_counts = {}
        sessions_by_salle = {}

        if salle_ids:
             counts_q = db.session.query(
                 Session.salle_id, func.count(Session.id)
             ).filter(Session.salle_id.in_(salle_ids)).group_by(Session.salle_id).all()
             session_counts = dict(counts_q)
             
             # Charger les sessions associées pour chaque salle
             sessions_q = Session.query.options(joinedload(Session.theme))\
                            .filter(Session.salle_id.in_(salle_ids))\
                            .order_by(Session.date.desc()).all() # Trier par date pour afficher les plus récentes
             for sess in sessions_q:
                 if sess.salle_id not in sessions_by_salle:
                     sessions_by_salle[sess.salle_id] = []
                 if len(sessions_by_salle[sess.salle_id]) < 5: # Limiter à 5 sessions par salle pour l'affichage
                    sessions_by_salle[sess.salle_id].append(sess)


        for s in salles_list:
             salles_data_for_template.append({
                 'obj': s,
                 'sessions_count': session_counts.get(s.id, 0),
                 'sessions_associees': sorted(sessions_by_salle.get(s.id, []), key=lambda x: x.date) # Trier par date
             })
        return render_template('salles.html', salles_data=salles_data_for_template)

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"Erreur DB chargement page salles: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement des salles.", "danger")
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Erreur inattendue chargement page salles: {e}", exc_info=True)
        flash("Une erreur interne est survenue lors du chargement des salles.", "danger")
    return redirect(url_for('admin'))

@app.route('/admin/salle/add', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def add_salle():
    if current_user.role != 'admin':
        flash("Action réservée aux administrateurs.", "danger")
        return redirect(url_for('dashboard'))
    try:
        nom = request.form.get('nom')
        capacite_str = request.form.get('capacite')
        lieu = request.form.get('lieu')
        description = request.form.get('description')

        if not nom or not capacite_str:
            flash("Le nom et la capacité de la salle sont obligatoires.", "warning")
            return redirect(url_for('salles_page'))
        try:
            capacite = int(capacite_str)
            if capacite <= 0: raise ValueError("Capacity must be positive")
        except ValueError:
            flash("La capacité doit être un nombre entier positif.", "warning")
            return redirect(url_for('salles_page'))

        existing_salle = Salle.query.filter_by(nom=nom).first()
        if existing_salle:
            flash(f"Une salle nommée '{nom}' existe déjà.", "warning")
            return redirect(url_for('salles_page'))

        new_salle = Salle(nom=nom, capacite=capacite, lieu=lieu, description=description)
        db.session.add(new_salle); db.session.commit()
        cache.delete_memoized(get_all_salles); cache.delete('dashboard_essential_data')
        add_activity('ajout_salle', f'Ajout salle: {new_salle.nom}', user=current_user)
        flash(f"Salle '{new_salle.nom}' ajoutée avec succès.", "success")
    except IntegrityError:
        db.session.rollback()
        flash(f"Erreur d'intégrité: Une salle nommée '{nom}' existe peut-être déjà.", "danger")
    except SQLAlchemyError as e:
        db.session.rollback(); app.logger.error(f"Erreur DB ajout salle: {e}", exc_info=True)
        flash("Erreur de base de données lors de l'ajout de la salle.", "danger")
    except Exception as e:
        db.session.rollback(); app.logger.error(f"Erreur inattendue ajout salle: {e}", exc_info=True)
        flash("Une erreur inattendue est survenue.", "danger")
    return redirect(url_for('salles_page'))

@app.route('/admin/salle/update/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def update_salle(id):
    if current_user.role != 'admin':
        flash("Action réservée aux administrateurs.", "danger")
        return redirect(url_for('dashboard'))
    
    salle = db.session.get(Salle, id)
    if not salle: flash("Salle introuvable.", "danger"); return redirect(url_for('salles_page'))
    try:
        nom = request.form.get('nom'); capacite_str = request.form.get('capacite')
        lieu = request.form.get('lieu'); description = request.form.get('description')
        if not nom or not capacite_str: flash("Le nom et la capacité sont obligatoires.", "warning"); return redirect(url_for('salles_page'))
        try:
            capacite = int(capacite_str)
            if capacite <= 0: raise ValueError("Capacity must be positive")
        except ValueError: flash("La capacité doit être un nombre entier positif.", "warning"); return redirect(url_for('salles_page'))
        if nom != salle.nom and Salle.query.filter(Salle.nom == nom, Salle.id != id).first():
            flash(f"Une autre salle nommée '{nom}' existe déjà.", "warning"); return redirect(url_for('salles_page'))
        
        salle.nom = nom; salle.capacite = capacite; salle.lieu = lieu; salle.description = description
        db.session.commit(); cache.delete_memoized(get_all_salles); cache.delete('dashboard_essential_data')
        add_activity('modification_salle', f'Modification salle: {salle.nom}', user=current_user)
        flash(f"Salle '{salle.nom}' mise à jour avec succès.", "success")
    except IntegrityError: db.session.rollback(); flash(f"Erreur d'intégrité màj salle '{salle.nom}'.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB màj salle {id}: {e}", exc_info=True); flash("Erreur DB màj.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue màj salle {id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('salles_page'))

@app.route('/admin/salle/delete/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def delete_salle(id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    salle = db.session.get(Salle, id)
    if not salle: flash("Salle introuvable.", "danger"); return redirect(url_for('salles_page'))
    try:
        if salle.sessions.first():
            flash(f"Impossible de supprimer '{salle.nom}', elle est utilisée. Réassignez d'abord les sessions.", "warning")
            return redirect(url_for('salles_page'))
        salle_nom = salle.nom; db.session.delete(salle); db.session.commit()
        cache.delete_memoized(get_all_salles); cache.delete('dashboard_essential_data')
        add_activity('suppression_salle', f'Suppression salle: {salle_nom}', user=current_user)
        flash(f"Salle '{salle_nom}' supprimée.", "success")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB suppression salle {id}: {e}", exc_info=True); flash("Erreur DB suppression.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue suppression salle {id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('salles_page'))

# --- Admin CRUD Routes for Thèmes ---
@app.route('/admin/theme/add', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def add_theme():
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    try:
        nom = request.form.get('nom'); description = request.form.get('description')
        if not nom: flash("Le nom du thème est obligatoire.", "warning"); return redirect(url_for('themes_page'))
        if Theme.query.filter_by(nom=nom).first(): flash(f"Un thème nommé '{nom}' existe déjà.", "warning"); return redirect(url_for('themes_page'))
        new_theme = Theme(nom=nom, description=description); db.session.add(new_theme); db.session.commit()
        cache.delete_memoized(get_all_themes); cache.delete('dashboard_essential_data')
        add_activity('ajout_theme', f'Ajout thème: {new_theme.nom}', user=current_user)
        flash(f"Thème '{new_theme.nom}' ajouté.", "success")
    except IntegrityError: db.session.rollback(); flash(f"Erreur d'intégrité: Thème '{nom}' existe déjà?", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB ajout thème: {e}", exc_info=True); flash("Erreur DB ajout thème.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue ajout thème: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('themes_page'))

@app.route('/admin/theme/update/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def update_theme(id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    theme = db.session.get(Theme, id)
    if not theme: flash("Thème introuvable.", "danger"); return redirect(url_for('themes_page'))
    try:
        nom = request.form.get('nom'); description = request.form.get('description')
        if not nom: flash("Le nom du thème est obligatoire.", "warning"); return redirect(url_for('themes_page'))
        if nom != theme.nom and Theme.query.filter(Theme.nom == nom, Theme.id != id).first():
            flash(f"Un autre thème nommé '{nom}' existe déjà.", "warning"); return redirect(url_for('themes_page'))
        theme.nom = nom; theme.description = description; db.session.commit()
        cache.delete_memoized(get_all_themes); cache.delete('dashboard_essential_data')
        add_activity('modification_theme', f'Modification thème: {theme.nom}', user=current_user)
        flash(f"Thème '{theme.nom}' mis à jour.", "success")
    except IntegrityError: db.session.rollback(); flash(f"Erreur d'intégrité màj thème '{theme.nom}'.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB màj thème {id}: {e}", exc_info=True); flash("Erreur DB màj.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue màj thème {id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('themes_page'))

@app.route('/admin/theme/delete/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def delete_theme(id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    theme = db.session.get(Theme, id)
    if not theme: flash("Thème introuvable.", "danger"); return redirect(url_for('themes_page'))
    try:
        theme_nom = theme.nom; db.session.delete(theme); db.session.commit() # Cascade should handle sessions/documents
        cache.delete_memoized(get_all_themes); cache.delete('dashboard_essential_data')
        add_activity('suppression_theme', f'Suppression thème: {theme_nom} et ses sessions/documents associés', user=current_user)
        flash(f"Thème '{theme_nom}' et ses dépendances supprimés.", "success")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB suppression thème {id}: {e}", exc_info=True); flash("Erreur DB suppression thème.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue suppression thème {id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('themes_page'))

# --- Admin CRUD Routes for Services ---
@app.route('/admin/service/add', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def add_service():
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    try:
        service_id = request.form.get('id'); nom = request.form.get('nom')
        responsable = request.form.get('responsable'); email_responsable = request.form.get('email_responsable')
        couleur = request.form.get('couleur', '#6c757d')
        if not all([service_id, nom, responsable, email_responsable]): flash("ID, Nom, Responsable et Email sont obligatoires.", "warning"); return redirect(url_for('services'))
        if Service.query.get(service_id): flash(f"Un service avec l'ID '{service_id}' existe déjà.", "warning"); return redirect(url_for('services'))
        if Service.query.filter_by(nom=nom).first(): flash(f"Un service nommé '{nom}' existe déjà.", "warning"); return redirect(url_for('services'))
        new_service = Service(id=service_id, nom=nom, responsable=responsable, email_responsable=email_responsable, couleur=couleur)
        db.session.add(new_service); db.session.commit()
        cache.delete_memoized(get_all_services_with_participants); cache.delete('dashboard_essential_data')
        add_activity('ajout_service', f'Ajout service: {new_service.nom}', user=current_user)
        flash(f"Service '{new_service.nom}' ajouté.", "success")
    except IntegrityError: db.session.rollback(); flash(f"Erreur d'intégrité: ID ou nom service existe déjà?", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB ajout service: {e}", exc_info=True); flash("Erreur DB ajout service.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue ajout service: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('services'))

@app.route('/admin/service/update/<service_id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def update_service(service_id):
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    service = db.session.get(Service, service_id)
    if not service: flash("Service introuvable.", "danger"); return redirect(url_for('services'))
    try:
        nom = request.form.get('nom'); responsable = request.form.get('responsable')
        email_responsable = request.form.get('email_responsable'); couleur = request.form.get('couleur', '#6c757d')
        if not all([nom, responsable, email_responsable]): flash("Nom, Responsable et Email sont obligatoires.", "warning"); return redirect(url_for('services'))
        if nom != service.nom and Service.query.filter(Service.nom == nom, Service.id != service_id).first():
            flash(f"Un autre service nommé '{nom}' existe déjà.", "warning"); return redirect(url_for('services'))
        service.nom = nom; service.responsable = responsable; service.email_responsable = email_responsable; service.couleur = couleur
        db.session.commit(); cache.delete_memoized(get_all_services_with_participants); cache.delete('dashboard_essential_data')
        add_activity('modification_service', f'Modification service: {service.nom}', user=current_user)
        flash(f"Service '{service.nom}' mis à jour.", "success")
    except IntegrityError: db.session.rollback(); flash(f"Erreur d'intégrité màj service '{service.nom}'.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB màj service {service_id}: {e}", exc_info=True); flash("Erreur DB màj.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue màj service {service_id}: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(url_for('services'))

@app.route('/admin/session/attribuer_salle', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2)
def attribuer_salle():
    if current_user.role != 'admin': flash("Action réservée aux administrateurs.", "danger"); return redirect(url_for('dashboard'))
    try:
        session_id_str = request.form.get('session_id'); salle_id_str = request.form.get('salle_id')
        if not session_id_str: flash("ID de session manquant.", "warning"); return redirect(request.referrer or url_for('sessions'))
        session_id = int(session_id_str); session_obj = db.session.get(Session, session_id)
        if not session_obj: flash("Session introuvable.", "danger"); return redirect(request.referrer or url_for('sessions'))
        salle_id = int(salle_id_str) if salle_id_str else None; salle_obj = None
        if salle_id:
            salle_obj = db.session.get(Salle, salle_id)
            if not salle_obj: flash("Salle introuvable.", "danger"); return redirect(request.referrer or url_for('sessions'))
        session_obj.salle_id = salle_id; db.session.commit()
        cache.delete(f'session_counts_{session_id}'); cache.delete_memoized(get_all_salles); cache.delete('dashboard_essential_data')
        action_desc = f"Salle '{salle_obj.nom if salle_obj else 'Aucune'}' attribuée à '{session_obj.theme.nom} du {session_obj.formatage_date}'"
        add_activity('attribution_salle', action_desc, user=current_user); flash(action_desc, "success")
    except ValueError: flash("ID de session ou de salle invalide.", "danger")
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB attribution salle: {e}", exc_info=True); flash("Erreur DB attribution salle.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue attribution salle: {e}", exc_info=True); flash("Erreur inattendue.", "danger")
    return redirect(request.referrer or url_for('sessions'))

@app.route('/themes')
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
             counts_q = db.session.query(Inscription.session_id, func.count(Inscription.id))\
                            .filter(Inscription.session_id.in_(session_ids), Inscription.statut == 'confirmé')\
                            .group_by(Inscription.session_id).all()
             confirmed_counts = dict(counts_q)
        for theme in themes_list:
            sessions_detailed = []
            for session in sorted(theme.sessions, key=lambda s: s.date):
                 confirmed_count = confirmed_counts.get(session.id, 0)
                 places_restantes = max(0, (session.max_participants or 0) - confirmed_count)
                 sessions_detailed.append({'obj': session, 'confirmed_count': confirmed_count, 'places_restantes': places_restantes})
            themes_data_for_template.append({'obj': theme, 'total_sessions': len(theme.sessions), 'sessions_detailed': sessions_detailed})
        csrf_token_field = None # Remplacer si Flask-WTF est utilisé
        return render_template('themes.html', themes_data=themes_data_for_template, csrf_token_field=csrf_token_field)
    except SQLAlchemyError as e: db.session.rollback(); app.logger.error(f"Erreur DB chargement page thèmes: {e}", exc_info=True); flash("Erreur DB chargement thèmes.", "danger")
    except Exception as e: db.session.rollback(); app.logger.error(f"Erreur inattendue chargement page thèmes: {e}", exc_info=True); flash("Erreur interne.", "danger")
    return redirect(url_for('admin'))

# ==============================================================================
# === Database Initialization (Data Seeding) ===
# ==============================================================================
def init_db():
    with app.app_context():
        try:
            app.logger.info("Vérification et initialisation des DONNÉES initiales (seeding)...")
            if not check_db_connection(): app.logger.error("Échec connexion DB pendant init données."); return False
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

            salle_tram_nom = 'Salle Tramontane'
            salle_tram = Salle.query.filter_by(nom=salle_tram_nom).first()
            if not salle_tram:
                app.logger.info(f"Ajout de '{salle_tram_nom}' (seed)...")
                salle_tram = Salle(nom=salle_tram_nom, capacite=15, lieu='Bâtiment A, RDC', description='Salle de formation polyvalente')
                db.session.add(salle_tram)
            elif salle_tram.capacite != 15 or salle_tram.lieu != 'Bâtiment A, RDC':
                app.logger.info(f"Mise à jour de '{salle_tram_nom}' (vérification post-seed)...")
                salle_tram.capacite = 15; salle_tram.lieu = 'Bâtiment A, RDC'; salle_tram.description = 'Salle de formation polyvalente'
            db.session.commit() # Commit après ajout ou mise à jour

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
                    theme_comm = Theme.query.filter(Theme.nom.like('%Communiquer%')).first()
                    theme_tasks = Theme.query.filter(Theme.nom.like('%Gérer les tâches%')).first()
                    theme_files = Theme.query.filter(Theme.nom.like('%Gérer mes fichiers%')).first()
                    theme_collab = Theme.query.filter(Theme.nom.like('%Collaborer%')).first()
                    salle_tram = Salle.query.filter_by(nom=salle_tram_nom).first() # Récupérer la salle par son nom standardisé
                    if not all([theme_comm, theme_tasks, theme_files, theme_collab, salle_tram]):
                         app.logger.error("Init sessions: Thèmes ou Salle Tramontane manquants."); raise ValueError("Missing Theme/Salle for session seeding.")
                    sessions_to_add = []
                    session_dates_themes = [
                        ('2025-05-13', [(time_obj(9,0),time_obj(10,30),theme_comm.id), (time_obj(10,45),time_obj(12,15),theme_comm.id), (time_obj(14,0),time_obj(15,30),theme_tasks.id), (time_obj(15,45),time_obj(17,15),theme_tasks.id)]),
                        ('2025-06-03', [(time_obj(9,0),time_obj(10,30),theme_tasks.id), (time_obj(10,45),time_obj(12,15),theme_tasks.id), (time_obj(14,0),time_obj(15,30),theme_files.id), (time_obj(15,45),time_obj(17,15),theme_files.id)]),
                        ('2025-06-20', [(time_obj(9,0),time_obj(10,30),theme_files.id), (time_obj(10,45),time_obj(12,15),theme_files.id), (time_obj(14,0),time_obj(15,30),theme_collab.id), (time_obj(15,45),time_obj(17,15),theme_collab.id)]),
                        ('2025-07-01', [(time_obj(9,0),time_obj(10,30),theme_collab.id), (time_obj(10,45),time_obj(12,15),theme_collab.id), (time_obj(14,0),time_obj(15,30),theme_comm.id), (time_obj(15,45),time_obj(17,15),theme_comm.id)])
                    ]
                    for date_str, timeslots in session_dates_themes:
                        date_obj = date.fromisoformat(date_str)
                        for start, end, theme_id in timeslots:
                            sessions_to_add.append(Session(date=date_obj, heure_debut=start, heure_fin=end, theme_id=theme_id, max_participants=15, salle_id=salle_tram.id))
                    db.session.bulk_save_objects(sessions_to_add); db.session.commit()
                    app.logger.info(f"{len(sessions_to_add)} sessions ajoutées (seed).")
                except Exception as sess_init_err: db.session.rollback(); app.logger.error(f"Erreur init sessions (seed): {sess_init_err}", exc_info=True)
            else:
                salle_tramontane = Salle.query.filter_by(nom=salle_tram_nom).first()
                if salle_tramontane:
                    updated_count = Session.query.filter(Session.salle_id != salle_tramontane.id).update({'salle_id': salle_tramontane.id})
                    if updated_count > 0: db.session.commit(); app.logger.info(f"{updated_count} sessions réassignées à {salle_tram_nom} (post-seed).")
                app.logger.info("Sessions déjà présentes (seeding ignoré, vérif salle effectuée).")

            if User.query.count() == 0:
                app.logger.info("Initialisation des utilisateurs (seeding)...")
                admin_user = User(username='admin', email='admin@anecoop-france.com', role='admin'); admin_user.set_password('Anecoop2025')
                db.session.add(admin_user); users_added_count = 1
                services = Service.query.all()
                for service in services:
                    base_username = "".join(filter(str.isalnum, service.responsable.split()[0])).lower()[:15]; username = base_username; counter = 1
                    while User.query.filter_by(username=username).first(): username = f"{base_username}{counter}"; counter += 1
                    responsable_user = User(username=username, email=service.email_responsable, role='responsable', service_id=service.id); responsable_user.set_password('Anecoop2025')
                    db.session.add(responsable_user); users_added_count += 1
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
                        db.session.add(Participant(nom=p_data['nom'], prenom=p_data['prenom'], email=p_data['email'], service_id=qualite_service.id)); participants_added += 1
                if participants_added > 0:
                    db.session.commit(); cache.delete_memoized(get_all_participants_with_service); cache.delete_memoized(get_all_services_with_participants)
                    app.logger.info(f"{participants_added} participants Qualité ajoutés (seed).")
                else: app.logger.info("Participants Qualité déjà présents (seeding ignoré).")
            else: app.logger.warning("Service 'qualite' non trouvé, impossible d'ajouter participants Qualité (seed).")

            if Activite.query.count() == 0:
                app.logger.info("Ajout activités initiales (seeding)...")
                admin_user = User.query.filter_by(role='admin').first()
                activites_data = [
                    {'type': 'systeme', 'description': 'Initialisation de l\'application', 'details': 'Base de données et données initiales créées'},
                    {'type': 'systeme', 'description': 'Création comptes utilisateurs initiaux', 'details': 'Admin et responsables créés', 'utilisateur_id': admin_user.id if admin_user else None}
                ]
                for data in activites_data: db.session.add(Activite(**data))
                db.session.commit(); app.logger.info("Activités initiales ajoutées (seed).")
            app.logger.info("Initialisation des données (seeding) terminée avec succès.")
            return True
        except SQLAlchemyError as e: db.session.rollback(); app.logger.exception(f"ÉCHEC INIT DB (SQLAlchemyError seeding): {e}"); print(f"ERREUR INIT DB (SEEDING): {e}"); return False
        except Exception as e: db.session.rollback(); app.logger.exception(f"ERREUR INATTENDUE INITIALISATION (SEEDING): {e}"); print(f"ERREUR INIT (SEEDING): {e}"); return False

# ==============================================================================
# === Main Execution ===
# ==============================================================================
if __name__ == '__main__':
    configure_logging(app) # Configurer le logging en premier
    is_production = os.environ.get('RENDER') or os.environ.get('FLASK_ENV') == 'production'
    port = int(os.environ.get('PORT', 5000))
    debug_mode = not is_production
    app.debug = debug_mode

    with app.app_context():
        app.logger.info("Application context entered for startup DB checks.")
        db_ready_for_seeding = False # Uniquement pour contrôler si on lance init_db()

        try:
            # 1. Vérifier la connexion à la base de données
            app.logger.info("Checking database connection...")
            connection_ok = check_db_connection()

            if connection_ok:
                app.logger.info("Database connection OK.")
                
                # 2. S'assurer que les tables existent.
                # En développement, on peut vouloir créer les tables si elles n'existent pas.
                # En production, on s'attend à ce que les migrations aient déjà créé les tables.
                # Pour simplifier et éviter les erreurs "too many connections" avec db.create_all()
                # sur des plans limités, nous allons supposer que les tables existent si la connexion est OK.
                # La première fois, vous devrez peut-être décommenter db.create_all() ou utiliser Flask-Migrate.
                
                # Optionnel : Décommentez ce bloc UNIQUEMENT pour la PREMIÈRE exécution ou si vous savez que les tables manquent.
                # try:
                #     app.logger.info("Ensuring all tables exist (db.create_all())...")
                #     db.create_all()
                #     app.logger.info("db.create_all() executed successfully (tables checked/created).")
                #     db_ready_for_seeding = True
                # except OperationalError as op_err:
                #     app.logger.error(f"Operational error during db.create_all() (check DB permissions/URL): {op_err}")
                #     # Ne pas continuer avec le seeding si create_all échoue
                # except Exception as create_err:
                #     app.logger.error(f"⚠️ Error during db.create_all(): {create_err}", exc_info=True)
                #     try:
                #         db.session.rollback()
                #     except Exception as rb_err:
                #         app.logger.error(f"Error during rollback after create_all() failure: {rb_err}")
                #     # Ne pas continuer avec le seeding
                # else: # Si le try de db.create_all() réussit sans exception
                #    pass # db_ready_for_seeding est déjà True

                # Pour un fonctionnement normal après la création initiale des tables :
                app.logger.info("Assuming tables exist if DB connection is OK. Skipping db.create_all(). Use migrations for schema changes.")
                db_ready_for_seeding = True


                # 3. Initialiser/vérifier les données de base (seeding) si la DB est prête
                if db_ready_for_seeding:
                    app.logger.info("Attempting data initialization/seeding (init_db())...")
                    if not init_db(): # init_db() se charge de vérifier si les données existent déjà
                        app.logger.error("⚠️ Data seeding (init_db()) reported an issue or failed.")
                    else:
                        app.logger.info("Data initialization/seeding (init_db()) completed.")
                else:
                     app.logger.warning("Skipping data seeding (init_db()) because database/table readiness is uncertain.")

            else: # connection_ok is False
                app.logger.critical("⚠️ CRITICAL DB CONNECTION ERROR at startup. Cannot proceed with DB checks or seeding.")
                print("⚠️ CRITICAL DB CONNECTION ERROR at startup. Application cannot start correctly.")
                sys.exit(1) # Quitter l'application si la connexion DB échoue au démarrage

        except OperationalError as oe: # Erreur de connexion attrapée par check_db_connection ou ici
            app.logger.critical(f"⚠️ CRITICAL DB OPERATIONAL ERROR during startup: {oe}")
            print(f"⚠️ CRITICAL DB OPERATIONAL ERROR during startup: {oe}")
            print("Application cannot start correctly. Check database server, URL, and permissions.")
            sys.exit(1)
        except Exception as e: # Autres erreurs critiques pendant le setup DB
            app.logger.critical(f"⚠️ CRITICAL UNEXPECTED ERROR during DB setup at startup: {e}", exc_info=True)
            print(f"⚠️ CRITICAL UNEXPECTED ERROR during DB setup: {e}")
            try:
                db.session.rollback() # Tenter un rollback au cas où
            except Exception as rb_e:
                app.logger.error(f"Error during rollback after critical startup error: {rb_e}")
            sys.exit(1)

    # Démarrage du serveur Flask-SocketIO
    try:
        host = '0.0.0.0'
        app.logger.info(f"Starting server in {'PRODUCTION' if is_production else 'DEVELOPMENT'} MODE with {ASYNC_MODE} on http://{host}:{port} (Debug: {debug_mode})")
        print(f"Starting server in {'PRODUCTION' if is_production else 'DEVELOPMENT'} MODE with {ASYNC_MODE} on http://{host}:{port} (Debug: {debug_mode})")

        if debug_mode:
            # use_reloader=True peut causer des problèmes avec gevent et les connexions DB au redémarrage.
            # Si vous avez des soucis de "too many connections" au redémarrage, mettez use_reloader=False.
            socketio.run(app, host=host, port=port, use_reloader=False, debug=debug_mode, log_output=False, allow_unsafe_werkzeug=True)
        else:
            # En production, vous devriez utiliser un vrai serveur WSGI comme Gunicorn avec gevent worker.
            # socketio.run() est principalement pour le développement.
            print("INFO: For production, use a dedicated WSGI server like Gunicorn with gevent workers.")
            socketio.run(app, host=host, port=port, debug=False, use_reloader=False)

    except Exception as e:
        app.logger.critical(f"⚠️ CRITICAL SERVER STARTUP ERROR: {e}", exc_info=True)
        print(f"⚠️ CRITICAL SERVER STARTUP ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
