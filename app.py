try:
    import eventlet
    eventlet.monkey_patch()
    ASYNC_MODE = 'eventlet'
    print("Eventlet monkey patching appliqué.")
except ImportError:
    ASYNC_MODE = 'threading'
    print(f"Mode asynchrone: {ASYNC_MODE}")
# ***** FIN EVENTLET PATCHING *****

import os
import sys
import functools
import random
import time
import psycopg2 # Pour l'enregistrement des types UNICODE
from datetime import datetime, timedelta, UTC, date, time as time_obj

from flask import (
    Flask, render_template, request, redirect, url_for,
    flash, jsonify, make_response, current_app
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
from sqlalchemy import func, text, select
import logging
from logging.handlers import RotatingFileHandler
from werkzeug.exceptions import ServiceUnavailable
from werkzeug.routing import BuildError # Importer BuildError pour une gestion plus fine
from ics import Calendar, Event
from ics.alarm import DisplayAlarm # Pour ics 0.7.2
import json # Si utilisé explicitement

# --- Configuration d'Encodage PostgreSQL ---
psycopg2.extensions.register_type(psycopg2.extensions.UNICODE)
psycopg2.extensions.register_type(psycopg2.extensions.UNICODEARRAY)

# --- Création de l'Application Flask ---
app = Flask(__name__)

# --- Configuration Générale de Flask ---
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'votre_super_cle_secrete_ici_en_production')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    "DATABASE_URL",
    "postgresql://xvcyuaga:rfodwjclemtvhwvqsrpp@alpha.europe.mkdb.sh:5432/usdtdsgq" # Exemple, utilisez votre URL
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ECHO'] = False # Mettre à True pour déboguer les requêtes SQL en développement

# Configuration du Pool de Connexions SQLAlchemy (adaptée pour une limite de 5 connexions totales)
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "client_encoding": "UTF8",
    "connect_args": {
        "options": "-c client_encoding=utf8"
    },
    'pool_size': 1,        # 1 connexion principale par worker Gunicorn
    'max_overflow': 1,     # 1 connexion supplémentaire temporaire par worker
                           # Total max par worker = 2. Avec 1 worker Gunicorn, total = 2.
    'pool_timeout': 10,    # Attendre 10s pour une connexion
    'pool_recycle': 280,   # Recycler les connexions après ~4.6 minutes (important pour DB hébergées)
    'pool_pre_ping': True  # Vérifier la connexion avant chaque utilisation
}

# Configuration du Cache
cache_config = {
    "CACHE_TYPE": "SimpleCache", # Ou "FileSystemCache", "RedisCache", etc. en production
    "CACHE_DEFAULT_TIMEOUT": 300 # 5 minutes par défaut
    # Pour FileSystemCache: "CACHE_DIR": os.path.join(app.root_path, 'cache')
}
app.config.from_mapping(cache_config)

# --- Initialisation des Extensions Flask ---
db = SQLAlchemy(app)
migrate = Migrate(app, db)
login_manager = LoginManager() # Initialiser sans app d'abord
cache = Cache(app)
limiter = Limiter(key_func=get_remote_address) # Initialiser sans app d'abord

# Initialisation différée des extensions qui nécessitent 'app'
login_manager.init_app(app)
limiter.init_app(app)

# Configuration de Flask-Login
login_manager.login_view = 'login' # Nom de la fonction de votre route de connexion
login_manager.login_message = "Veuillez vous connecter pour accéder à cette page."
login_manager.login_message_category = "info"


socketio = SocketIO(
    app,
    cors_allowed_origins="*", # À restreindre en production !
    async_mode=ASYNC_MODE,
    engineio_logger=False, 
    logger=False,          
    ping_timeout=20000,
    ping_interval=25000,
    transports=['polling'], 
    manage_session=False # Si vous gérez les sessions utilisateur avec Flask-Login
)

# --- Configuration du Logging ---
logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
if not os.path.exists(logs_dir):
    try:
        os.makedirs(logs_dir)
    except OSError as e:
        app.logger.error(f"Impossible de créer le dossier de logs {logs_dir}: {e}")

def configure_logging(app_instance):
    log_level = logging.DEBUG if app_instance.debug else logging.INFO
    
    # Supprimer les handlers existants pour éviter la duplication lors des rechargements
    # (plus robuste que d'itérer et supprimer)
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

    if not app_instance.debug: # Configuration pour la production
        try:
            app_log_file = os.path.join(logs_dir, 'app.log')
            file_handler = RotatingFileHandler(app_log_file, maxBytes=5*1024*1024, backupCount=5, encoding='utf-8')
            file_handler.setFormatter(formatter)
            file_handler.setLevel(logging.INFO)
            app_instance.logger.addHandler(file_handler)

            db_log_file = os.path.join(logs_dir, 'db.log')
            db_file_handler = RotatingFileHandler(db_log_file, maxBytes=2*1024*1024, backupCount=3, encoding='utf-8')
            db_file_handler.setFormatter(formatter)
            db_logger = logging.getLogger('sqlalchemy.engine')
            db_logger.addHandler(db_file_handler)
            db_logger.setLevel(logging.WARNING)
            db_logger.propagate = False

            # ... (configuration similaire pour socketio_logger, engineio_logger si nécessaire) ...
            app_instance.logger.info('Logging de production initialisé (fichiers).')
        except Exception as e:
            app_instance.logger.error(f"Erreur lors de la configuration du logging de fichier: {e}")
    else:
        logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO) # Plus verbeux en dev
        app_instance.logger.info('Logging de développement initialisé (console).')

configure_logging(app)

# --- Fonctions de Contexte et Teardown ---
@app.context_processor
def inject_global_template_vars():
    return dict(
        debug_mode=app.debug,
        now=datetime.now(UTC),
        app_name="Formation Microsoft 365 - Anecoop France" # Pour l'affichage
    )

@app.teardown_appcontext
def shutdown_session_proper(exception=None):
    if hasattr(db, 'session'):
        if exception:
            app.logger.debug(f"Teardown: Exception détectée, rollback de la session DB: {exception}")
            try:
                db.session.rollback()
            except Exception as rb_e:
                app.logger.error(f"Teardown: Erreur pendant le rollback de la session DB: {rb_e}")
        try:
            db.session.remove()
            # app.logger.debug("Teardown: Session SQLAlchemy retirée.")
        except Exception as e:
            app.logger.error(f"Teardown: Erreur lors du retrait de la session SQLAlchemy: {e}")

# --- Décorateur DB Retry ---
def db_operation_with_retry(max_retries=3, retry_delay=0.5, 
                            retry_on_exceptions=(OperationalError, TimeoutError),
                            fail_on_exceptions=(IntegrityError, SQLAlchemyError)): # Ne pas réessayer sur les erreurs de logique
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            last_exception = None
            while retries < max_retries:
                try:
                    result = func(*args, **kwargs)
                    return result
                except retry_on_exceptions as e:
                    retries += 1
                    last_exception = e
                    app.logger.warning(f"DB operation '{func.__name__}' failed (attempt {retries}/{max_retries}): {type(e).__name__} - {e}")
                    try:
                        db.session.rollback()
                    except Exception as rb_ex:
                        app.logger.error(f"Error during rollback in retry decorator for '{func.__name__}': {rb_ex}")
                    
                    if retries >= max_retries:
                        app.logger.error(f"Max retries ({max_retries}) reached for DB operation '{func.__name__}'. Last error: {e}")
                        raise ServiceUnavailable(f"Database service for '{func.__name__}' temporarily unavailable after multiple retries.")
                    
                    wait_time = (retry_delay * (2 ** (retries -1))) + random.uniform(0, retry_delay * 0.25) # Jitter plus petit
                    app.logger.info(f"Retrying DB operation '{func.__name__}' in {wait_time:.2f} seconds...")
                    time.sleep(wait_time) 
                except fail_on_exceptions as e: # Erreurs SQLAlchemy qui ne devraient pas être réessayées
                    db.session.rollback()
                    app.logger.error(f"SQLAlchemyError (not retried) during DB operation '{func.__name__}': {e}", exc_info=True)
                    raise # Re-lever pour que la route puisse la gérer
                except Exception as e: # Erreurs Python inattendues
                    db.session.rollback() 
                    app.logger.error(f"Unexpected Python error during DB operation '{func.__name__}': {e}", exc_info=True)
                    raise
            
            if last_exception: # Ne devrait être atteint que pour les retry_on_exceptions
                 raise ServiceUnavailable(f"Database service for '{func.__name__}' unavailable after {max_retries} retries. Last error: {last_exception}")
            raise ServiceUnavailable(f"Database service for '{func.__name__}' unavailable after {max_retries} retries (unknown reason).")
        return wrapper
    return decorator

# === Modèles DB (Identiques à v7) ===
class Service(db.Model):
    __tablename__ = 'service'
    id = db.Column(db.String(20), primary_key=True)
    nom = db.Column(db.String(100), nullable=False, unique=True)
    couleur = db.Column(db.String(7), nullable=False, default='#6c757d')
    responsable = db.Column(db.String(100), nullable=False)
    email_responsable = db.Column(db.String(100), nullable=False)
    participants = db.relationship('Participant', backref='service', lazy='select') # lazy='select' is often default but explicit
    users = db.relationship('User', backref='service', lazy='select')

    def __repr__(self):
        return f'<Service {self.id}: {self.nom}>'

class Salle(db.Model):
    __tablename__ = 'salle'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False, unique=True)
    capacite = db.Column(db.Integer, default=10, nullable=False)
    lieu = db.Column(db.String(200), nullable=True)
    description = db.Column(db.Text, nullable=True)
    sessions = db.relationship('Session', backref='salle', lazy='dynamic') # lazy='dynamic' for potential filtering

    def __repr__(self):
        return f'<Salle {self.id}: {self.nom}>'

class Theme(db.Model):
    __tablename__ = 'theme'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False, unique=True)
    description = db.Column(db.Text, nullable=True)
    # Use selectinload for sessions if often accessed together
    sessions = db.relationship('Session', backref='theme', lazy='select')

    def __repr__(self):
        return f'<Theme {self.id}: {self.nom}>'

class Session(db.Model):
    __tablename__ = 'session'
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, index=True) # Index date
    heure_debut = db.Column(db.Time, nullable=False)
    heure_fin = db.Column(db.Time, nullable=False)
    theme_id = db.Column(db.Integer, db.ForeignKey('theme.id'), nullable=False, index=True) # Index foreign key
    max_participants = db.Column(db.Integer, default=10, nullable=False)
    salle_id = db.Column(db.Integer, db.ForeignKey('salle.id'), nullable=True, index=True) # Index foreign key
    # Use dynamic for potentially large collections that need filtering/counting
    inscriptions = db.relationship('Inscription', backref='session', lazy='selectin', cascade="all, delete-orphan")
    liste_attente = db.relationship('ListeAttente', backref='session', lazy='selectin', cascade="all, delete-orphan")

    # Calculate places restantes efficiently (can be cached)
    def get_places_restantes(self, confirmed_count=None):
        try:
            if confirmed_count is None:
                # Efficient count query
                confirmed_count = db.session.query(func.count(Inscription.id)).filter(
                    Inscription.session_id == self.id,
                    Inscription.statut == 'confirmé'
                ).scalar() or 0
            return max(0, self.max_participants - confirmed_count)
        except Exception as e:
            app.logger.error(f"Error calculating places restantes for S:{self.id}: {e}")
            # In case of error, assume full to prevent overbooking
            return 0

    # Properties for formatting (handle potential errors)
    @property
    def formatage_date(self):
        try:
            # French locale formatting (requires locale setup on server or manual mapping)
            # Using manual mapping for portability
            jours = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
            mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
            return f"{jours[self.date.weekday()]} {self.date.day} {mois[self.date.month-1]} {self.date.year}"
        except Exception:
            return self.date.strftime('%d/%m/%Y') # Fallback

    @property
    def formatage_horaire(self):
        try:
            debut = f"{self.heure_debut.hour:02d}h{self.heure_debut.minute:02d}"
            fin = f"{self.heure_fin.hour:02d}h{self.heure_fin.minute:02d}"
            return f"{debut}–{fin}"
        except Exception:
            return f"{self.heure_debut.strftime('%H:%M')}–{self.heure_fin.strftime('%H:%M')}" # Fallback

    @property
    def formatage_ics(self):
        """
        Retourne les datetime de début et de fin pour le fichier ICS, en UTC.
        Tente de gérer les fuseaux horaires de manière plus robuste.
        """
        try:
            if not isinstance(self.date, date) or \
               not isinstance(self.heure_debut, time_obj) or \
               not isinstance(self.heure_fin, time_obj):
                app.logger.error(f"ICS Formatting Error S:{self.id}: Invalid date/time types. Date: {type(self.date)}, Start: {type(self.heure_debut)}, End: {type(self.heure_fin)}")
                now_utc = datetime.now(UTC)
                return now_utc, now_utc + timedelta(hours=1)

            naive_start_dt = datetime.combine(self.date, self.heure_debut)
            naive_end_dt = datetime.combine(self.date, self.heure_fin)

            # --- DÉBUT DU CODE MANQUANT/CORRIGÉ ---
            try:
                start_dt_aware = naive_start_dt.astimezone() 
                end_dt_aware = naive_end_dt.astimezone()     
                start_utc = start_dt_aware.astimezone(UTC)
                end_utc = end_dt_aware.astimezone(UTC)
            except Exception as tz_err:
                app.logger.warning(f"ICS Timezone Warning S:{self.id}: Could not reliably determine server timezone. Assuming naive times are UTC. Error: {tz_err}")
                start_utc = naive_start_dt.replace(tzinfo=UTC)
                end_utc = naive_end_dt.replace(tzinfo=UTC)
            
            if end_utc <= start_utc:
                app.logger.warning(f"ICS Formatting Warning S:{self.id}: End time ({end_utc}) not after start time ({start_utc}). Setting end to start + 1 hour.")
                end_utc = start_utc + timedelta(hours=1)
            
            app.logger.debug(f"ICS Dates for S:{self.id} - Start (UTC): {start_utc}, End (UTC): {end_utc}")
            return start_utc, end_utc
            # --- FIN DU CODE MANQUANT/CORRIGÉ ---

        except Exception as e: # Ajout du bloc except pour le try principal
            app.logger.error(f"Critical error in formatage_ics for S:{self.id}: {e}", exc_info=True)
            now_utc = datetime.now(UTC)
            return now_utc, now_utc + timedelta(hours=1)


    def __repr__(self): # Cette ligne correspondait à votre ligne 321
        theme_nom = self.theme.nom if self.theme else "N/A"
        return f'<Session {self.id} - {theme_nom} le {self.date.strftime("%Y-%m-%d")}>'

class Participant(db.Model):
    __tablename__ = 'participant'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    prenom = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), nullable=False, unique=True, index=True)
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=False, index=True) # Index foreign key
    # Use dynamic for potentially large collections
    inscriptions = db.relationship('Inscription', backref='participant', lazy='dynamic', cascade="all, delete-orphan")
    liste_attente = db.relationship('ListeAttente', backref='participant', lazy='dynamic', cascade="all, delete-orphan")

    def __repr__(self):
        return f'<Participant {self.id}: {self.prenom} {self.nom}>'

class Inscription(db.Model):
    __tablename__ = 'inscription'
    id = db.Column(db.Integer, primary_key=True)
    participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False, index=True) # Index
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False, index=True) # Index
    date_inscription = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False)
    statut = db.Column(db.String(20), default='en attente', nullable=False, index=True) # Index status
    validation_responsable = db.Column(db.Boolean, default=False, nullable=False)
    presence = db.Column(db.Boolean, default=None, nullable=True) # Nullable boolean for presence
    notification_envoyee = db.Column(db.Boolean, default=False, nullable=False)
    __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_inscription'),)

    def __repr__(self):
        return f'<Inscription {self.id} - P:{self.participant_id} S:{self.session_id} Statut:{self.statut}>'

class ListeAttente(db.Model):
    __tablename__ = 'liste_attente'
    id = db.Column(db.Integer, primary_key=True)
    participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False, index=True) # Index
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False, index=True) # Index
    date_inscription = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False)
    position = db.Column(db.Integer, nullable=False)
    notification_envoyee = db.Column(db.Boolean, default=False, nullable=False)
    __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_liste_attente'),)

    def __repr__(self):
        return f'<ListeAttente {self.id} - P:{self.participant_id} S:{self.session_id} Pos:{self.position}>'

class Activite(db.Model):
    __tablename__ = 'activite'
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(50), nullable=False, index=True)
    description = db.Column(db.Text, nullable=False)
    details = db.Column(db.Text, nullable=True)
    date = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False, index=True)
    utilisateur_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True) # Nullable if system action
    utilisateur = db.relationship('User', backref='activites_generees', foreign_keys=[utilisateur_id])

    @property
    def date_relative(self):
        # Corrected indentation and logic
        now = datetime.now(UTC)
        # Ensure self.date is timezone-aware (assuming UTC if naive)
        aware_date = self.date.replace(tzinfo=UTC) if self.date.tzinfo is None else self.date

        if not isinstance(aware_date, datetime): # Basic type check
             return "Date invalide"

        try:
            if aware_date > now:
                return f"le {aware_date.strftime('%d/%m/%Y à %H:%M')}"

            diff = now - aware_date
            seconds = diff.total_seconds()

            if seconds < 5: return "à l'instant"
            if seconds < 60: return f"il y a {int(seconds)} seconde{'s' if int(seconds) >= 2 else ''}"
            if seconds < 3600:
                minutes = int(seconds // 60)
                return f"il y a {minutes} minute{'s' if minutes >= 2 else ''}"
            if seconds < 86400:
                hours = int(seconds // 3600)
                return f"il y a {hours} heure{'s' if hours >= 2 else ''}"
            days = int(seconds // 86400)
            if days == 1: return "hier"
            if days <= 7: return f"il y a {days} jours"
            # For dates older than a week, show the actual date
            return f"le {aware_date.strftime('%d/%m/%Y')}"
        except Exception as e:
            app.logger.error(f"Error calculating relative date for activity {self.id}: {e}")
            try:
                return self.date.strftime('%d/%m/%Y %H:%M') # Fallback
            except:
                 return "Date inconnue"


    def __repr__(self):
        return f'<Activite {self.id} - Type:{self.type} Date:{self.date.strftime("%Y-%m-%d %H:%M")}>'

class User(UserMixin, db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    role = db.Column(db.String(20), default='user', nullable=False, index=True) # Index role
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=True) # Nullable for admin/general users
    # activites_generees defined by backref

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f'<User {self.id}: {self.username} ({self.role})>'

# === Flask-Login Configuration ===
@login_manager.user_loader
def load_user(user_id):
    try:
        # Use db.session.get for primary key lookups (more efficient)
        return db.session.get(User, int(user_id))
    except Exception as e:
        app.logger.error(f"Error loading user {user_id}: {e}")
        return None

# === Database Session Teardown ===
@app.teardown_appcontext
def shutdown_session(exception=None):
    if exception:
        # Log the exception that caused the teardown
        app.logger.debug(f"Rolling back session due to exception: {exception}")
        try:
            db.session.rollback()
        except Exception as rb_e:
            # Log error during rollback itself
            app.logger.error(f"Error during session rollback: {rb_e}")
    try:
        # Always try to remove the session
        db.session.remove()
    except Exception as e:
        app.logger.error(f"Error removing session: {e}")

# === Helper Functions ===
@db_operation_with_retry(max_retries=3)
def check_db_connection():
    """Checks if the database connection is active."""
    try:
        # A simple query to check connection health
        db.session.execute(text("SELECT 1"))
        # No need to commit a SELECT 1
        return True
    except Exception as e:
        app.logger.error(f"DB Connection health check failed: {e}")
        db.session.rollback() # Rollback in case the session is in a weird state
        return False

def generate_ics(session, participant, salle=None):
    """
    Génère le contenu d'un fichier calendrier ICS pour une inscription.
    Attend des objets Session et Participant valides.
    Optimisé pour ics==0.7.2.
    """
    app.logger.info(f"--- generate_ics called (ics 0.7.2 method, description fix) ---")
    app.logger.info(f"Attempting for S_ID:{getattr(session, 'id', 'None')}, P_ID:{getattr(participant, 'id', 'None')}")

    try:
        # Vérifications robustes des données d'entrée (inchangées)
        if not session:
            app.logger.error("ICS Gen Error: Session object is None.")
            return None
        if not hasattr(session, 'theme') or not session.theme or not hasattr(session.theme, 'nom') or not session.theme.nom:
            app.logger.error(f"ICS Gen Error: Session S_ID:{getattr(session, 'id', 'N/A')} - theme or theme.nom is missing or invalid.")
            return None
        if not participant:
            app.logger.error("ICS Gen Error: Participant object is None.")
            return None
        if not hasattr(participant, 'prenom') or not participant.prenom or \
           not hasattr(participant, 'nom') or not participant.nom:
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
        
        description_parts = [
            "FORMATION MICROSOFT 365 - ANECOOP FRANCE",
            f"\nThème: {session.theme.nom}"
        ]
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

        # --- CORRECTION POUR L'ALARME AVEC ICS 0.7.2 ---
        alarm = DisplayAlarm(trigger=timedelta(hours=-1))
        # Assigner la description comme un attribut de l'objet alarme
        alarm.description = f"Rappel: Formation {session.theme.nom}"
        
        event.alarms.add(alarm)
        # --- FIN DE LA CORRECTION ---

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
    """Checks if a spot opened up and notifies the next person on the waitlist."""
    try:
        session = db.session.get(Session, session_id)
        if not session:
            app.logger.warning(f"check_waitlist called for non-existent session {session_id}")
            return False

        # Check places again within the transaction
        if session.get_places_restantes() <= 0:
            return False # No places available

        # Find the next person on the waitlist who hasn't been notified
        next_in_line = ListeAttente.query.filter_by(
            session_id=session_id,
            notification_envoyee=False
        ).order_by(ListeAttente.position).first()

        if next_in_line:
            # Mark as notified within the transaction
            next_in_line.notification_envoyee = True
            db.session.commit() # Commit the notification status change

            # Emit notification via SocketIO
            socketio.emit('notification', {
                'event': 'place_disponible',
                'message': f"Une place s'est libérée pour la formation '{session.theme.nom}' du {session.formatage_date}!",
                'session_id': session_id,
                'participant_id': next_in_line.participant_id
            }, room=f'user_{next_in_line.participant_id}') # Target specific user if possible

            # Log the activity
            add_activity('notification', f'Notification place dispo envoyée',
                         f'Session: {session.theme.nom}, Part: {next_in_line.participant.prenom} {next_in_line.participant.nom}')
            app.logger.info(f"Notified P:{next_in_line.participant_id} for S:{session_id} waitlist opening.")
            return True # Notification sent

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error during check_waitlist for S:{session_id}: {e}")
    except Exception as e:
        # Catch unexpected errors, rollback just in case
        db.session.rollback()
        app.logger.error(f"Unexpected error during check_waitlist for S:{session_id}: {e}", exc_info=True)

    return False # No notification sent or error occurred

@db_operation_with_retry(max_retries=3)
def add_activity(type, description, details=None, user=None):
    """Adds an entry to the activity log and emits a SocketIO event."""
    try:
        # Determine the user for the log entry
        log_user = user if user else current_user # Get the user object (could be current_user or AnonymousUserMixin)

        # ** FIX V9: Check if the user is authenticated before accessing .id **
        user_id_for_db = None
        if log_user and log_user.is_authenticated:
            user_id_for_db = log_user.id

        activite = Activite(
            type=type,
            description=description,
            details=details,
            utilisateur_id=user_id_for_db # Use the potentially None ID
        )
        db.session.add(activite)
        db.session.commit()
        # Refresh is needed to get calculated properties like date_relative and relationships
        # Need to handle case where utilisateur might be None after refresh if ID was None
        db.session.refresh(activite)

        # Prepare data for SocketIO emission
        user_username = activite.utilisateur.username if activite.utilisateur else None # Check if utilisateur relationship loaded
        date_rel = activite.date_relative # Access the property after refresh

        # Emit event to update activity feeds
        socketio.emit('nouvelle_activite', {
            'id': activite.id,
            'type': activite.type,
            'description': activite.description,
            'details': activite.details,
            'date_relative': date_rel,
            'user': user_username
        }, room='general') # Emit to a general room for all connected clients

        app.logger.debug(f"Activity logged: {type} - {description}")
        return True
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error adding activity '{type}': {e}")
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error adding activity '{type}': {e}", exc_info=True)
    return False

@db_operation_with_retry(max_retries=3)
def update_theme_names():
    """Ensures specific theme names and descriptions are standardized."""
    with app.app_context():
        try:
            changes_made = False
            # Standardize 'OneDrive/SharePoint' theme
            onedrive_theme = Theme.query.filter(Theme.nom.like('%OneDrive%')).first()
            target_name_files = 'Gérer mes fichiers (OneDrive/SharePoint)'
            target_desc_files = 'Apprenez à organiser et partager vos fichiers avec OneDrive et SharePoint.'
            if onedrive_theme and (onedrive_theme.nom != target_name_files or onedrive_theme.description != target_desc_files):
                onedrive_theme.nom = target_name_files
                onedrive_theme.description = target_desc_files
                changes_made = True
                app.logger.info(f"Standardized theme: {target_name_files}")

            # Standardize 'Collaborer avec Teams' theme
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
                cache.delete('all_themes') # Invalidate cache
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


# Cached helper functions (using Flask-Caching)
@cache.cached(timeout=300, key_prefix='all_themes')
@db_operation_with_retry(max_retries=3)
def get_all_themes():
    """Returns a cached list of all themes, ordered by name."""
    app.logger.debug("Cache miss or expired: Fetching all themes from DB.")
    return Theme.query.order_by(Theme.nom).all()

@cache.cached(timeout=300, key_prefix='all_services_with_participants')
@db_operation_with_retry(max_retries=3)
def get_all_services_with_participants():
    """Returns a cached list of all services with participants eager loaded."""
    app.logger.debug("Cache miss or expired: Fetching all services with participants from DB.")
    # Use selectinload for potentially large participant lists per service
    return Service.query.options(selectinload(Service.participants)).order_by(Service.nom).all()

@cache.cached(timeout=180, key_prefix='all_salles')
@db_operation_with_retry(max_retries=3)
def get_all_salles():
    """Returns a cached list of all salles, ordered by name."""
    app.logger.debug("Cache miss or expired: Fetching all salles from DB.")
    return Salle.query.order_by(Salle.nom).all()

@cache.cached(timeout=180, key_prefix='participants_list_with_service')
@db_operation_with_retry(max_retries=3)
def get_all_participants_with_service():
    """Returns a cached list of all participants with their service eager loaded."""
    app.logger.debug("Cache miss or expired: Fetching all participants with service from DB.")
    # Use joinedload for the one-to-one service relationship
    return Participant.query.options(joinedload(Participant.service)).order_by(Participant.nom, Participant.prenom).all()


# === WebSocket Event Handlers (Polling only, minimal handlers) ===
@socketio.on('connect')
def handle_connect():
    app.logger.info(f'Client connected (polling): {request.sid}')
    # Minimal response, actual data fetched via API
    emit('status', {'msg': 'Connected via polling'})
    join_room('general') # Join general room for potential broadcast messages

@socketio.on('disconnect')
def handle_disconnect():
    app.logger.info(f'Client disconnected (polling): {request.sid}')

@socketio.on('join')
def handle_join(data):
    room = data.get('room', 'general')
    sid = request.sid
    join_room(room)
    app.logger.info(f'Client {sid} joined room (polling): {room}')
    emit('status', {'msg': f'Joined room {room}'}, room=sid)

# Heartbeat can be useful even with polling to check client presence
@socketio.on('heartbeat')
def handle_heartbeat(data):
    emit('heartbeat_response', {'timestamp': datetime.now(UTC).timestamp()})


# === Flask Routes ===

# --- Core Navigation & Auth ---
@app.route('/')
def index():
    # Redirect root to dashboard
    return redirect(url_for('dashboard'))

@app.route('/login', methods=['GET', 'POST'])
@db_operation_with_retry(max_retries=3)
def login():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        remember = True # Always remember for simplicity, or add checkbox: request.form.get('remember')

        if not username or not password:
             flash('Nom d\'utilisateur et mot de passe requis.', 'warning')
             return render_template('login.html')

        try:
            # Query user case-insensitively for username for better UX
            user = User.query.filter(func.lower(User.username) == func.lower(username)).first()

            if user and user.check_password(password):
                login_user(user, remember=remember)
                add_activity('connexion', f'Connexion de {user.username}', user=user)
                # Redirect to intended page or dashboard
                next_page = request.args.get('next')
                # Basic security check for next_page
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

@app.route('/validation_inscription_ajax', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=2) # Moins de tentatives pour les requêtes API rapides
def validation_inscription_ajax():
    try:
        data = request.get_json()
        inscription_id = data.get('inscription_id')
        action = data.get('action')

        if not inscription_id or not action:
            app.logger.warning("Validation AJAX: inscription_id ou action manquant.")
            return jsonify({'success': False, 'message': 'Données manquantes.'}), 400

        inscription = db.session.get(Inscription, int(inscription_id)) # Utiliser db.session.get

        if not inscription:
            app.logger.warning(f"Validation AJAX: Inscription {inscription_id} introuvable.")
            return jsonify({'success': False, 'message': 'Inscription introuvable.'}), 404

        # Vérification des autorisations (Admin ou Responsable du service du participant)
        participant = inscription.participant # Relation déjà chargée
        session_obj = inscription.session     # Relation déjà chargée
        
        is_admin = current_user.role == 'admin'
        is_responsable = (current_user.role == 'responsable' and 
                          participant and participant.service and 
                          current_user.service_id == participant.service_id)

        if not (is_admin or is_responsable):
            app.logger.warning(f"Validation AJAX: User {current_user.username} non autorisé pour inscription {inscription_id}.")
            return jsonify({'success': False, 'message': 'Action non autorisée.'}), 403

        # Logique de validation/refus
        original_status = inscription.statut
        message = ""

        if action == 'valider' and original_status == 'en attente':
            if session_obj.get_places_restantes() <= 0:
                app.logger.info(f"Validation AJAX: Session {session_obj.id} complète, impossible de valider inscription {inscription_id}.")
                return jsonify({'success': False, 'message': 'Impossible de valider : la session est complète.'})
            
            inscription.statut = 'confirmé'
            inscription.validation_responsable = True
            message = 'Inscription validée avec succès.'
            add_activity('validation', f'Validation AJAX: {participant.prenom} {participant.nom}',
                         f'Session: {session_obj.theme.nom}', user=current_user)
            cache.delete(f'session_counts_{session_obj.id}') # Invalider le cache
            # Notifier via SocketIO (si vous voulez garder cette fonctionnalité)
            socketio.emit('inscription_validee', {
                'inscription_id': inscription.id, 'session_id': session_obj.id,
                'participant_id': participant.id, 'new_status': 'confirmé'
            }, room='general')


        elif action == 'refuser' and original_status == 'en attente':
            inscription.statut = 'refusé'
            message = 'Inscription refusée.'
            add_activity('refus', f'Refus AJAX: {participant.prenom} {participant.nom}',
                         f'Session: {session_obj.theme.nom}', user=current_user)
            # Pas besoin d'invalider le cache des comptes de session ici
            socketio.emit('inscription_refusee', {
                'inscription_id': inscription.id, 'session_id': session_obj.id,
                'participant_id': participant.id, 'new_status': 'refusé'
            }, room='general')
        else:
            app.logger.warning(f"Validation AJAX: Action '{action}' invalide ou statut '{original_status}' incorrect pour inscription {inscription_id}.")
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

@app.route('/dashboard')
# @login_required # Semble être public dans votre version
@db_operation_with_retry(max_retries=3)
def dashboard():
    """Affiche le tableau de bord principal avec les statistiques, les sessions, et les demandes en attente."""
    app.logger.info(f"User '{current_user.username if current_user.is_authenticated else 'Anonymous'}' accessing /dashboard.")
    try:
        # --- Données de base (souvent mises en cache via les helpers) ---
        themes = get_all_themes() 
        services_for_modal = get_all_services_with_participants() # Renommé pour clarté
        salles_for_modal = get_all_salles() 
        participants_for_modal = get_all_participants_with_service() 

        # --- Données des sessions avec pré-chargement AGRESSIF ---
        sessions_query = Session.query.options(
            selectinload(Session.theme),
            selectinload(Session.salle),
            # Pré-charger les inscriptions AVEC leurs participants ET le service du participant
            selectinload(Session.inscriptions).selectinload(Inscription.participant).selectinload(Participant.service),
            # Pré-charger la liste d'attente AVEC ses participants ET le service du participant
            selectinload(Session.liste_attente).selectinload(ListeAttente.participant).selectinload(Participant.service)
        ).order_by(Session.date, Session.heure_debut)
        
        sessions_from_db = sessions_query.all()
        app.logger.info(f"Fetched {len(sessions_from_db)} sessions with eager loading for dashboard.")

        # --- Récupérer les inscriptions en attente de validation ---
        pending_validations_list = []
        if current_user.is_authenticated and (current_user.role == 'admin' or current_user.role == 'responsable'):
            query_pending = Inscription.query.options(
                joinedload(Inscription.participant).selectinload(Participant.service),
                joinedload(Inscription.session).selectinload(Session.theme) # Charger le thème de la session aussi
            ).filter(Inscription.statut == 'en attente')

            # Si l'utilisateur est un responsable, filtrer par son service
            if current_user.role == 'responsable' and current_user.service_id:
                # S'assurer que la jointure avec Participant est faite si ce n'est pas déjà le cas
                # (joinedload s'en occupe normalement, mais une jointure explicite peut être plus claire)
                query_pending = query_pending.join(Inscription.participant).filter(Participant.service_id == current_user.service_id)
            
            pending_validations_list = query_pending.order_by(Inscription.date_inscription.asc()).all()
            app.logger.info(f"Fetched {len(pending_validations_list)} pending validation(s) for user '{current_user.username}'.")


        # --- Calculs globaux et préparation des données des sessions pour le template ---
        total_inscriptions_confirmees_global = 0
        total_en_attente_global_liste_attente = 0 # Participants en liste d'attente (pas les inscriptions "en attente")
        total_sessions_completes_global = 0
        
        sessions_data_for_template = []
        for s_obj in sessions_from_db: 
            try:
                inscrits_confirmes_list = [i for i in s_obj.inscriptions if i.statut == 'confirmé']
                pending_inscriptions_list = [i for i in s_obj.inscriptions if i.statut == 'en attente']
                # s_obj.liste_attente est maintenant une liste grâce à lazy='selectin'
                liste_attente_entries_list = s_obj.liste_attente 

                inscrits_count = len(inscrits_confirmes_list)
                attente_count = len(liste_attente_entries_list) # Compte de la liste d'attente pour CETTE session
                pending_valid_count = len(pending_inscriptions_list) # Compte des inscriptions en attente pour CETTE session
                places_rest = max(0, (s_obj.max_participants or 0) - inscrits_count)

                # Mise à jour des totaux globaux
                total_inscriptions_confirmees_global += inscrits_count
                total_en_attente_global_liste_attente += attente_count # Accumuler les participants en liste d'attente de chaque session
                if places_rest == 0:
                    total_sessions_completes_global += 1

                sessions_data_for_template.append({
                    'obj': s_obj,
                    'places_restantes': places_rest,
                    'inscrits_confirmes_count': inscrits_count,
                    'liste_attente_count': attente_count,
                    'pending_count': pending_valid_count,
                    # IMPORTANT: Passer les listes pré-chargées pour les modales
                    'loaded_inscrits_confirmes': sorted(inscrits_confirmes_list, key=lambda i: i.date_inscription, reverse=True),
                    'loaded_pending_inscriptions': sorted(pending_inscriptions_list, key=lambda i: i.date_inscription, reverse=True),
                    'loaded_liste_attente': sorted(liste_attente_entries_list, key=lambda la: la.position)
                })

            except Exception as sess_error:
                app.logger.error(f"Error processing session {s_obj.id} for dashboard: {sess_error}", exc_info=True)
                sessions_data_for_template.append({
                    'obj': s_obj, 'places_restantes': 0, 'inscrits_confirmes_count': 0,
                    'liste_attente_count': 0, 'pending_count': 0, 'error': True,
                    'loaded_inscrits_confirmes': [], 'loaded_pending_inscriptions': [], 'loaded_liste_attente': []
                })

        app.logger.debug(f"Dashboard Globals: InscritsConf={total_inscriptions_confirmees_global}, EnListeAttente={total_en_attente_global_liste_attente}, SessionsComplètes={total_sessions_completes_global}")

        return render_template('dashboard.html',
                              themes=themes,
                              sessions_data=sessions_data_for_template, # Contient objets Session, comptes ET listes pré-chargées
                              services=services_for_modal, 
                              participants=participants_for_modal,
                              salles=salles_for_modal,
                              total_inscriptions=total_inscriptions_confirmees_global,
                              total_en_attente=total_en_attente_global_liste_attente, # Ceci est le total des listes d'attente
                              total_sessions_completes=total_sessions_completes_global,
                              pending_validations=pending_validations_list, # La liste des inscriptions en attente de validation
                              # Passer les classes Modèle si nécessaire
                              Inscription=Inscription,
                              ListeAttente=ListeAttente)

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading dashboard: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement du tableau de bord.", "danger")
        return render_template('error.html', error_message="Erreur base de données."), 500
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error in dashboard route: {e}", exc_info=True)
        flash("Une erreur interne est survenue.", "danger")
        return render_template('error.html', error_message="Erreur interne du serveur."), 500

@app.route('/services') # <<< --- THIS DECORATOR WAS MISSING ---
# @login_required # Removed for public access in your version
@db_operation_with_retry(max_retries=3)
def services():
    """Displays the list of services and their participants."""
    try:
        # Use cached helper function with eager loading of participants
        # This function should return a list of Service objects with their 'participants' relationship loaded
        services_list = get_all_services_with_participants() # Cached

        # Pre-calculate participant counts and confirmed inscription counts
        services_data = []
        
        # Get all participant IDs from the loaded services to optimize inscription count query
        all_participant_ids = [p.id for service_obj in services_list for p in service_obj.participants]
        
        confirmed_counts_by_participant = {}
        if all_participant_ids:
            # Fetch confirmed inscription counts for all relevant participants in one query
            # Ensure Inscription model is correctly imported
            confirmed_q = db.session.query(
                Inscription.participant_id, func.count(Inscription.id)
            ).filter(
                Inscription.participant_id.in_(all_participant_ids),
                Inscription.statut == 'confirmé'
            ).group_by(Inscription.participant_id).all()
            confirmed_counts_by_participant = dict(confirmed_q)

        for s_obj in services_list:
            participants_detailed_list = []
            # Sort participants associated with the service
            # Ensure s_obj.participants is accessed (it should be loaded by get_all_services_with_participants)
            sorted_participants = sorted(s_obj.participants, key=lambda x: (x.prenom or '', x.nom or ''))
            
            for p in sorted_participants:
                # Get the pre-calculated count for this participant
                confirmed_count = confirmed_counts_by_participant.get(p.id, 0)
                participants_detailed_list.append({
                    'obj': p, 
                    'confirmed_count': confirmed_count
                })

            services_data.append({
                'obj': s_obj,
                'participant_count': len(s_obj.participants), # Count of participants in this service
                'participants_detailed': participants_detailed_list # Pass detailed list with counts
            })

        # Pass the processed data to the template
        return render_template('services.html', services_data=services_data)

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading services page: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement des services.", "danger")
        return redirect(url_for('dashboard')) # Redirect to a safe page on error
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error loading services page: {e}", exc_info=True)
        flash("Une erreur interne est survenue lors du chargement des services.", "danger")
        return redirect(url_for('dashboard')) # Redirect to a safe page on error


@app.route('/sessions')
@db_operation_with_retry(max_retries=3)
def sessions():
    """Affiche la liste des sessions avec filtres et modales pour actions."""
    app.logger.info(f"User '{current_user.username if current_user.is_authenticated else 'Anonymous'}' accessing /sessions.")
    try:
        # Requête de base avec pré-chargement optimisé (selectinload fonctionnera maintenant)
        query = Session.query.options(
            selectinload(Session.theme),
            selectinload(Session.salle),
            selectinload(Session.inscriptions).selectinload(Inscription.participant).selectinload(Participant.service),
            selectinload(Session.liste_attente).selectinload(ListeAttente.participant).selectinload(Participant.service) # Ceci fonctionnera maintenant
        ).order_by(Session.date, Session.heure_debut)

        # Application des filtres (inchangé)
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
            
            # Accès direct aux listes (elles sont chargées par selectinload)
            inscrits_confirmes_list = [i for i in s_obj.inscriptions if i.statut == 'confirmé']
            pending_inscriptions_list = [i for i in s_obj.inscriptions if i.statut == 'en attente']
            # s_obj.liste_attente est maintenant une liste directement
            liste_attente_entries_list = s_obj.liste_attente 

            inscrits_count = len(inscrits_confirmes_list)
            attente_count = len(liste_attente_entries_list)
            pending_count = len(pending_inscriptions_list)
            places_rest = max(0, (s_obj.max_participants or 0) - inscrits_count)

            # Appliquer le filtre 'places' (inchangé)
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
                # Passer les listes pré-chargées et triées pour les modales
                'loaded_inscrits_confirmes': sorted(inscrits_confirmes_list, key=lambda i: i.date_inscription, reverse=True),
                'loaded_pending_inscriptions': sorted(pending_inscriptions_list, key=lambda i: i.date_inscription, reverse=True),
                'loaded_liste_attente': sorted(liste_attente_entries_list, key=lambda la: la.position)
            })
        
        app.logger.info(f"Prepared {len(sessions_final_data)} sessions for template after all filters.")

        # Données pour les filtres et les modales (inchangé)
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
    """
    Gère l'inscription d'un participant existant à une session.
    Si une inscription inactive (refusé/annulé) existe, elle est réactivée en 'en attente'.
    Si la session est pleine, redirige vers la liste d'attente.
    """
    from_page_value = request.form.get('from_page', 'dashboard')
    valid_from_pages = ['admin', 'services', 'participants', 'sessions', 'dashboard']
    redirect_url = url_for(from_page_value) if from_page_value in valid_from_pages else url_for('dashboard')

    app.logger.info(f"--- Route /inscription POST (v2 - handle inactive) ---")
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

        # 1. Vérifier une inscription "active" (confirmé ou en attente)
        existing_active_inscription = Inscription.query.filter(
            Inscription.participant_id == participant_a_inscrire.id,
            Inscription.session_id == session_obj.id,
            Inscription.statut.in_(['confirmé', 'en attente'])
        ).first()

        if existing_active_inscription:
            flash(f'{participant_a_inscrire.prenom} {participant_a_inscrire.nom} a déjà une inscription "{existing_active_inscription.statut}" pour cette session.', 'warning')
            return redirect(redirect_url)
        
        # 2. Vérifier si le participant est déjà sur la liste d'attente pour cette session
        existing_waitlist = ListeAttente.query.filter_by(
            participant_id=participant_a_inscrire.id, 
            session_id=session_obj.id
        ).first()

        if existing_waitlist:
            flash(f'{participant_a_inscrire.prenom} {participant_a_inscrire.nom} est déjà en liste d\'attente (position {existing_waitlist.position}) pour cette session.', 'warning')
            return redirect(redirect_url)

        # 3. Vérifier si une inscription "inactive" (refusé, annulé) existe déjà pour réactiver
        existing_inactive_inscription = Inscription.query.filter(
            Inscription.participant_id == participant_a_inscrire.id,
            Inscription.session_id == session_obj.id,
            Inscription.statut.in_(['refusé', 'annulé']) 
        ).first()

        # Calculer les places restantes basé UNIQUEMENT sur les confirmés
        current_confirmed_for_session = db.session.query(func.count(Inscription.id)).filter(
            Inscription.session_id == session_obj.id,
            Inscription.statut == 'confirmé'
        ).scalar() or 0
        places_disponibles = session_obj.get_places_restantes(confirmed_count=current_confirmed_for_session)
        
        app.logger.debug(f"S_ID={session_obj.id}: Places disponibles calculées = {places_disponibles} (Confirmés actuels: {current_confirmed_for_session})")

        if places_disponibles <= 0:
            app.logger.info(f"Session S_ID={session_obj.id} complète. Redirection vers liste d'attente pour P_ID={participant_a_inscrire.id}.")
            flash(f'La session "{session_obj.theme.nom}" est complète. Une inscription en liste d\'attente est nécessaire.', 'info')
            return redirect(url_for('liste_attente', 
                                    session_id=session_obj.id, 
                                    participant_id=participant_a_inscrire.id, 
                                    from_page=from_page_value))

        # Si on arrive ici, il y a des places disponibles pour une nouvelle inscription (ou réactivation)

        if existing_inactive_inscription:
            app.logger.info(f"Réactivation de l'inscription inactive (statut: {existing_inactive_inscription.statut}) pour P_ID={participant_a_inscrire.id} à S_ID={session_obj.id}.")
            existing_inactive_inscription.statut = 'en attente'
            existing_inactive_inscription.date_inscription = datetime.now(UTC) # Mettre à jour la date de la (nouvelle) demande
            existing_inactive_inscription.validation_responsable = False # Réinitialiser la validation
            # Autres champs à réinitialiser si nécessaire (ex: notification_envoyee)
            db.session.add(existing_inactive_inscription) # Assure que l'objet est suivi
            flash_message = f'Votre précédente inscription ({existing_inactive_inscription.statut}) pour "{participant_a_inscrire.prenom} {participant_a_inscrire.nom}" à la session "{session_obj.theme.nom}" a été réactivée et est maintenant en attente de validation.'
            activity_type = 'reinscription'
            activity_desc = f'Réactivation inscription: {participant_a_inscrire.prenom} {participant_a_inscrire.nom}'
        else:
            # Créer une nouvelle inscription "en attente"
            app.logger.info(f"Création d'une nouvelle inscription 'en attente' pour P_ID={participant_a_inscrire.id} à S_ID={session_obj.id}.")
            new_inscription = Inscription(
                participant_id=participant_a_inscrire.id, 
                session_id=session_obj.id, 
                statut='en attente'
            )
            db.session.add(new_inscription)
            flash_message = f'Votre demande d\'inscription pour "{participant_a_inscrire.prenom} {participant_a_inscrire.nom}" à la session "{session_obj.theme.nom}" a été enregistrée et est en attente de validation.'
            activity_type = 'inscription'
            activity_desc = f'Demande inscription: {participant_a_inscrire.prenom} {participant_a_inscrire.nom}'

        db.session.commit()
        
        cache.delete(f'session_counts_{session_obj.id}')
        app.logger.info(f"Cache invalidé pour session_counts_{session_obj.id} (inscription/réactivation).")

        add_activity(activity_type, 
                     activity_desc,
                     f'Session: {session_obj.theme.nom} ({session_obj.formatage_date})', 
                     user=current_user if current_user.is_authenticated else None)
        
        socketio.emit('inscription_nouvelle', { # Peut-être un type d'event différent pour réactivation?
            'session_id': session_obj.id,
            'participant_id': participant_a_inscrire.id,
            'statut': 'en attente' # Toujours 'en attente' après cette action
        }, room='general')

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
# @login_required # Removed for public access
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

        # Check if already inscribed or on waitlist
        if (ListeAttente.query.filter_by(participant_id=participant_id, session_id=session_id).first() or
            Inscription.query.filter_by(participant_id=participant_id, session_id=session_id).first()):
            flash(f"{participant.prenom} {participant.nom} est déjà inscrit(e) ou en liste d'attente.", 'warning')
            return redirect(redirect_url)

        # Check if places have become available
        if session_obj.get_places_restantes() > 0:
            flash(f"Bonne nouvelle ! Il reste {session_obj.get_places_restantes()} place(s) pour cette session. Vous pouvez vous inscrire directement.", 'info')
            # Optionally redirect to inscription modal or page
            return redirect(url_for('sessions')) # Or dashboard

        if request.method == 'POST':
            # Calculate position on waitlist
            position = db.session.query(func.count(ListeAttente.id)).filter(
                ListeAttente.session_id == session_id).scalar() + 1

            attente = ListeAttente(participant_id=participant_id, session_id=session_id, position=position)
            db.session.add(attente)
            db.session.commit()
            cache.delete(f'session_counts_{session_id}') # Invalidate cache

            add_activity('liste_attente', f'Ajout liste attente: {participant.prenom} {participant.nom}',
                        f'Session: {session_obj.theme.nom} ({session_obj.formatage_date}) - Position: {position}',
                        user=current_user) # Pass current_user (might be anonymous)

            # Notify via SocketIO
            socketio.emit('liste_attente_nouvelle', {
                'session_id': session_id,
                'participant_id': participant.id,
                'position': position,
                'total_session_attente': position # Total count on waitlist now
            }, room='general')

            flash(f'Vous avez été ajouté(e) à la liste d\'attente en position {position}.', 'success')
            return redirect(url_for('dashboard')) # Redirect after successful POST

    except IntegrityError:
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

    # If GET request or error during POST, render the confirmation page
    if request.method == 'GET':
         return render_template('liste_attente.html', participant=participant, session=session_obj)
    else: # Error during POST
         return redirect(redirect_url)


@app.route('/validation_inscription/<int:inscription_id>', methods=['POST'])
@login_required # Keep this protected
@db_operation_with_retry(max_retries=3)
def validation_inscription(inscription_id):
    redirect_url = request.referrer or url_for('dashboard')
    try:
        # Eager load related objects needed
        inscription = Inscription.query.options(
            joinedload(Inscription.participant).joinedload(Participant.service),
            joinedload(Inscription.session).joinedload(Session.theme)
        ).get(inscription_id)

        if not inscription:
            flash('Inscription introuvable.', 'danger')
            return redirect(redirect_url)

        # Authorization check
        is_admin = current_user.role == 'admin'
        # Check if participant and service exist before accessing service_id
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
        session_id = inscription.session_id

        if action == 'valider' and inscription.statut == 'en attente':
            # Check places before validating
            if inscription.session.get_places_restantes() <= 0:
                flash("Impossible de valider : la session est complète.", "warning")
                return redirect(redirect_url)

            inscription.statut = 'confirmé'
            inscription.validation_responsable = True # Mark as validated
            db.session.commit()
            cache.delete(f'session_counts_{session_id}') # Invalidate cache

            add_activity('validation', f'Validation inscription: {participant_name}',
                        session_info, user=current_user)
            flash('Inscription validée avec succès.', 'success')

            # Notify via SocketIO
            socketio.emit('inscription_validee', {
                'inscription_id': inscription.id, 'session_id': session_id,
                'participant_id': inscription.participant_id, 'new_status': 'confirmé'
            }, room='general')

        elif action == 'refuser' and inscription.statut == 'en attente':
            inscription.statut = 'refusé'
            db.session.commit()
            # No need to invalidate session count cache here

            add_activity('refus', f'Refus inscription: {participant_name}',
                        session_info, user=current_user)
            flash('Inscription refusée.', 'warning')

            # Notify via SocketIO
            socketio.emit('inscription_refusee', {
                'inscription_id': inscription.id, 'session_id': session_id,
                'participant_id': inscription.participant_id, 'new_status': 'refusé'
            }, room='general')

        elif action == 'annuler' and inscription.statut == 'confirmé':
            inscription.statut = 'annulé'
            db.session.commit()
            cache.delete(f'session_counts_{session_id}') # Invalidate cache

            add_activity('annulation', f'Annulation inscription: {participant_name}',
                        session_info, user=current_user)
            flash('Inscription annulée avec succès.', 'success')

            # Check waitlist after cancellation
            check_waitlist(session_id)

            # Notify via SocketIO
            socketio.emit('inscription_annulee', {
                'inscription_id': inscription.id, 'session_id': session_id,
                'participant_id': inscription.participant_id, 'new_status': 'annulé'
            }, room='general')

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

@app.route('/add_participant', methods=['POST'])
@db_operation_with_retry(max_retries=3)
def add_participant():
    from_page_value = request.form.get('from_page', 'participants')
    valid_from_pages = ['admin', 'services', 'participants', 'sessions', 'dashboard']
    redirect_url = url_for(from_page_value) if from_page_value in valid_from_pages else url_for('participants')
    
    app.logger.info(f"--- Route /add_participant POST (v2 - handle inactive for auto-inscription) ---")
    app.logger.debug(f"Form data: {request.form}")

    nom = request.form.get('nom', '').strip().upper()
    prenom = request.form.get('prenom', '').strip().capitalize()
    email_form = request.form.get('email', '').strip().lower() # Renommé pour clarté
    service_id_form = request.form.get('service_id', '').strip()

    redirect_session_id_str = request.form.get('redirect_session_id')
    action_after_add = request.form.get('action_after_add')

    try:
        # --- Validation des champs du nouveau participant ---
        if not all([nom, prenom, email_form, service_id_form]):
            flash('Nouveau Participant : Tous les champs marqués * sont obligatoires.', 'danger')
            app.logger.warning(f"add_participant: Validation échouée - champs manquants.")
            return redirect(redirect_url)

        if '@' not in email_form or '.' not in email_form.split('@')[-1]:
            flash('Format d\'email invalide pour le nouveau participant.', 'danger')
            return redirect(redirect_url)

        service_obj = db.session.get(Service, service_id_form)
        if not service_obj:
            flash('Le service sélectionné pour le nouveau participant est invalide.', 'danger')
            return redirect(redirect_url)

        # --- Vérification si un participant avec cet email existe déjà ---
        participant_existant_par_email = Participant.query.filter(func.lower(Participant.email) == email_form).first()
        if participant_existant_par_email:
            flash_msg = f'Un participant avec l\'email {email_form} existe déjà : {participant_existant_par_email.prenom} {participant_existant_par_email.nom} (Service: {participant_existant_par_email.service.nom}).'
            if request.form.get('from_modal') == 'true': # Si vient d'une modale d'inscription
                flash_msg += ' Veuillez sélectionner ce participant dans l\'onglet "Participant existant" pour l\'inscrire.'
                 # Si on voulait quand même inscrire ce participant existant à la session demandée:
                if redirect_session_id_str and action_after_add == 'inscription':
                    app.logger.info(f"add_participant: Email existant. Tentative d'inscription du P_ID existant {participant_existant_par_email.id} à S_ID {redirect_session_id_str} au lieu de créer un doublon.")
                    # Ici, on pourrait appeler une fonction d'inscription ou rediriger vers la route inscription
                    # avec les bons paramètres. Pour l'instant, on redirige simplement.
                    # return redirect(url_for('inscription', participant_id=participant_existant_par_email.id, session_id=redirect_session_id_str, from_page=from_page_value)) # Nécessiterait que la route inscription gère GET
                    # Pour l'instant, on se contente du message et on laisse l'utilisateur refaire l'action.
            flash(flash_msg, 'warning')
            app.logger.warning(f"add_participant: Tentative de création d'un participant avec un email existant: {email_form}")
            return redirect(redirect_url)

        # --- Création du nouveau participant ---
        nouveau_participant = Participant(nom=nom, prenom=prenom, email=email_form, service_id=service_id_form)
        db.session.add(nouveau_participant)
        db.session.commit() 
        
        id_nouveau_participant = nouveau_participant.id 
        nom_complet_nouveau_participant = f"{nouveau_participant.prenom} {nouveau_participant.nom}"
        app.logger.info(f"add_participant: Nouveau participant créé P_ID={id_nouveau_participant}, Nom={nom_complet_nouveau_participant}, Email={email_form}")

        cache.delete('participants_list_with_service')
        cache.delete(f'service_participant_count_{service_id_form}') 
        cache.delete('all_services_with_participants')

        add_activity('ajout_participant', f'Ajout participant: {nom_complet_nouveau_participant}', 
                     f'Service: {nouveau_participant.service.nom}', 
                     user=current_user if current_user.is_authenticated else None)
        
        message_base_succes = f'Participant "{nom_complet_nouveau_participant}" ajouté avec succès.'

        # --- Inscription automatique si demandée ---
        if redirect_session_id_str and action_after_add == 'inscription':
            app.logger.info(f"add_participant: Action post-ajout: Inscription à S_ID={redirect_session_id_str} pour NOUVEAU P_ID={id_nouveau_participant}")
            try:
                session_id_pour_inscription = int(redirect_session_id_str)
                session_cible = db.session.get(Session, session_id_pour_inscription)

                if not session_cible:
                    flash(message_base_succes + " Cependant, la session pour l'inscription automatique est introuvable.", "warning")
                    return redirect(redirect_url)

                # Pour un NOUVEAU participant, il ne devrait y avoir AUCUNE inscription ou liste d'attente existante.
                # La vérification ici est une sécurité contre des conditions de course ou des erreurs de logique ailleurs.
                existing_inscription_for_new = Inscription.query.filter_by(participant_id=id_nouveau_participant, session_id=session_id_pour_inscription).first()
                existing_waitlist_for_new = ListeAttente.query.filter_by(participant_id=id_nouveau_participant, session_id=session_id_pour_inscription).first()

                if existing_inscription_for_new or existing_waitlist_for_new:
                    flash(f'Erreur Interne : Le participant {nom_complet_nouveau_participant} (nouvellement créé) semble déjà être lié à cette session. Veuillez contacter un administrateur.', 'danger')
                    app.logger.error(f"add_participant: ERREUR LOGIQUE - P_ID={id_nouveau_participant} (nouveau) trouvé comme déjà inscrit/en attente pour S_ID={session_id_pour_inscription}.")
                    return redirect(redirect_url) # Ou une autre page d'erreur

                current_confirmed_for_session = db.session.query(func.count(Inscription.id)).filter(
                    Inscription.session_id == session_id_pour_inscription,
                    Inscription.statut == 'confirmé'
                ).scalar() or 0
                
                places_disponibles = session_cible.get_places_restantes(confirmed_count=current_confirmed_for_session)

                if places_disponibles <= 0:
                    position = (db.session.query(func.count(ListeAttente.id)).filter_by(session_id=session_id_pour_inscription).scalar() or 0) + 1
                    attente = ListeAttente(participant_id=id_nouveau_participant, session_id=session_id_pour_inscription, position=position)
                    db.session.add(attente)
                    db.session.commit()
                    cache.delete(f'session_counts_{session_id_pour_inscription}')
                    add_activity('liste_attente', f'Ajout liste attente (auto via ajout P.): {nom_complet_nouveau_participant}', 
                                 f'S:{session_id_pour_inscription}, Pos:{position}', user=current_user if current_user.is_authenticated else None)
                    socketio.emit('liste_attente_nouvelle', {'session_id': session_id_pour_inscription, 'participant_id': id_nouveau_participant, 'position': position}, room='general')
                    flash(message_base_succes + f" Ajouté(e) à la liste d'attente (position {position}) pour la session '{session_cible.theme.nom}'.", 'success')
                else:
                    inscription_auto = Inscription(participant_id=id_nouveau_participant, session_id=session_id_pour_inscription, statut='en attente')
                    db.session.add(inscription_auto)
                    db.session.commit()
                    cache.delete(f'session_counts_{session_id_pour_inscription}')
                    add_activity('inscription', f'Demande inscription (auto via ajout P.): {nom_complet_nouveau_participant}', 
                                 f'S:{session_id_pour_inscription}', user=current_user if current_user.is_authenticated else None)
                    socketio.emit('inscription_nouvelle', {'session_id': session_id_pour_inscription, 'participant_id': id_nouveau_participant, 'statut': 'en attente'}, room='general')
                    flash(message_base_succes + f" Demande d'inscription pour la session '{session_cible.theme.nom}' enregistrée (en attente de validation).", 'success')
                
                return redirect(redirect_url)

            except ValueError:
                 flash(message_base_succes + " Mais l'ID de session pour l'inscription automatique était invalide.", "warning")
                 app.logger.error(f"add_participant: ValueError pour redirect_session_id_str '{redirect_session_id_str}'.")
            except Exception as post_add_err:
                 db.session.rollback()
                 flash(message_base_succes + " Mais une erreur est survenue lors de l'inscription automatique.", "danger")
                 app.logger.error(f"add_participant: Erreur inattendue post-ajout/inscription: {post_add_err}", exc_info=True)
        else:
            flash(message_base_succes, 'success')

        return redirect(redirect_url)

    except IntegrityError as ie:
        db.session.rollback()
        flash(f'Erreur d\'intégrité : Un participant avec cet email ({email_form}) existe déjà ou un autre conflit est survenu.', 'danger')
        app.logger.error(f"add_participant: IntegrityError - {ie}", exc_info=True)
    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de l\'ajout du participant.', 'danger')
        app.logger.error(f"add_participant: SQLAlchemyError - {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue lors de l\'ajout du participant.', 'danger')
        app.logger.error(f"add_participant: Erreur inattendue - {e}", exc_info=True)

    return redirect(redirect_url)

    
@app.route('/update_participant/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def update_participant(id):
    participant = db.session.get(Participant, id)
    redirect_url = url_for('participants')

    if not participant:
        flash('Participant introuvable.', 'danger')
        return redirect(redirect_url)

    # Authorization
    if current_user.role != 'admin' and (current_user.role != 'responsable' or current_user.service_id != participant.service_id):
        flash('Action non autorisée.', 'danger')
        return redirect(redirect_url)

    try:
        original_email = participant.email
        old_service_id = participant.service_id

        # Get form data
        new_nom = request.form.get('nom', '').strip().upper()
        new_prenom = request.form.get('prenom', '').strip().capitalize()
        new_email = request.form.get('email', '').strip().lower()
        new_service_id = request.form.get('service_id', '').strip()

        # Validation
        if not all([new_nom, new_prenom, new_email, new_service_id]):
            flash('Tous les champs marqués * sont obligatoires.', 'danger')
            return redirect(redirect_url) # Or render edit modal with error

        if '@' not in new_email or '.' not in new_email.split('@')[-1]:
            flash('Format d\'email invalide.', 'danger')
            return redirect(redirect_url)

        # Check if new email is already used by another participant
        if new_email != original_email and Participant.query.filter(
                func.lower(Participant.email) == new_email,
                Participant.id != id).first():
            flash(f'L\'email {new_email} est déjà utilisé par un autre participant.', 'warning')
            return redirect(redirect_url)

        # Check if new service exists
        if not db.session.get(Service, new_service_id):
             flash('Service invalide.', 'danger')
             return redirect(redirect_url)

        # Update participant
        participant.nom = new_nom
        participant.prenom = new_prenom
        participant.email = new_email
        participant.service_id = new_service_id

        db.session.commit()

        # Invalidate caches
        cache.delete('participants_list_with_service')
        if old_service_id != new_service_id:
            cache.delete(f'service_participant_count_{old_service_id}')
            cache.delete(f'service_participant_count_{new_service_id}')
        # Invalidate service cache if participant list was eager loaded there
        cache.delete('all_services_with_participants')


        add_activity('modification_participant', f'Modification participant: {participant.prenom} {participant.nom}',
                   f'Nouveau Service: {participant.service.nom}', user=current_user)

        flash('Participant mis à jour avec succès.', 'success')

    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de la mise à jour.', 'danger')
        app.logger.error(f"SQLAlchemyError updating participant {id}: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Error updating participant {id}: {e}", exc_info=True)

    return redirect(redirect_url)

@app.route('/delete_participant/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def delete_participant(id):
    # Only admins can delete
    if current_user.role != 'admin':
        flash('Action réservée aux administrateurs.', 'danger')
        return redirect(url_for('participants'))

    participant = db.session.get(Participant, id)
    redirect_url = url_for('participants')

    if not participant:
        flash('Participant introuvable.', 'danger')
        return redirect(redirect_url)

    try:
        # Check for confirmed inscriptions before deleting
        inscriptions_count = db.session.query(func.count(Inscription.id)).filter(
            Inscription.participant_id == id,
            Inscription.statut == 'confirmé'
        ).scalar() or 0

        if inscriptions_count > 0:
            flash(f'Impossible de supprimer "{participant.prenom} {participant.nom}", car il/elle a {inscriptions_count} inscription(s) confirmée(s). Annulez d\'abord les inscriptions.', 'danger')
            return redirect(redirect_url)

        # If no confirmed inscriptions, proceed with deletion
        # SQLAlchemy cascade should handle related inscriptions/waitlist entries
        nom_participant = f"{participant.prenom} {participant.nom}"
        service_id = participant.service_id # Get service ID before deleting

        db.session.delete(participant)
        db.session.commit()

        # Invalidate caches
        cache.delete('participants_list_with_service')
        cache.delete(f'service_participant_count_{service_id}')
        cache.delete('all_services_with_participants')

        add_activity('suppression_participant', f'Suppression participant: {nom_participant}', user=current_user)

        flash(f'Participant "{nom_participant}" et ses inscriptions non confirmées / listes d\'attente ont été supprimés.', 'success')

    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de la suppression.', 'danger')
        app.logger.error(f"SQLAlchemyError deleting participant {id}: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue lors de la suppression.', 'danger')
        app.logger.error(f"Error deleting participant {id}: {e}", exc_info=True)

    return redirect(redirect_url)


# --- Route /participants (Optimized v9) ---
# --- Route /participants (Optimized v9) ---
@app.route('/participants')
# @login_required # As per your app.py, this is commented out or removed
@db_operation_with_retry(max_retries=3)
def participants():
    # Authorization Check (optional, based on your app's logic)
    # if current_user.is_authenticated and current_user.role not in ['admin', 'responsable']:
    #     flash('Accès au contenu détaillé réservé.', 'warning')

    try:
        # Fetch participants with their service eagerly loaded
        participants_list = get_all_participants_with_service() # Cached

        # Fetch all services for the "Add Participant" modal filter
        services_list_for_dropdown = Service.query.order_by(Service.nom).all() # Not cached here, but could be

        participant_ids = [p.id for p in participants_list]
        
        # Dictionaries to hold pre-loaded data
        inscriptions_by_participant = {}
        waitlist_by_participant = {}

        if participant_ids:
            # Eager load ALL inscriptions for these participants with session and theme/salle
            all_inscriptions_q = Inscription.query.options(
                joinedload(Inscription.session).options(
                    joinedload(Session.theme),
                    joinedload(Session.salle)
                )
            ).filter(Inscription.participant_id.in_(participant_ids)).all()
            
            for insc in all_inscriptions_q:
                if insc.participant_id not in inscriptions_by_participant:
                    inscriptions_by_participant[insc.participant_id] = []
                inscriptions_by_participant[insc.participant_id].append(insc)

            # Eager load ALL waitlist entries for these participants with session and theme/salle
            all_waitlist_q = ListeAttente.query.options(
                 joinedload(ListeAttente.session).options(
                    joinedload(Session.theme),
                    joinedload(Session.salle)
                ),
                joinedload(ListeAttente.participant) # Participant already loaded via participants_list, but good for consistency
            ).filter(ListeAttente.participant_id.in_(participant_ids)).all()
            
            for wl_entry in all_waitlist_q:
                 if wl_entry.participant_id not in waitlist_by_participant:
                     waitlist_by_participant[wl_entry.participant_id] = []
                 waitlist_by_participant[wl_entry.participant_id].append(wl_entry)

        # Prepare data for the template, including pre-filtered/sorted lists for modals
        participants_data_for_template = []
        for p_obj in participants_list:
            all_p_inscriptions = inscriptions_by_participant.get(p_obj.id, [])
            
            p_confirmed_inscriptions = sorted(
                [i for i in all_p_inscriptions if i.statut == 'confirmé'],
                key=lambda i: i.session.date if i.session and i.session.date else date.min
            )
            p_pending_inscriptions = sorted(
                [i for i in all_p_inscriptions if i.statut == 'en attente'],
                key=lambda i: i.date_inscription, reverse=True
            )
            
            p_waitlist_entries = sorted(
                waitlist_by_participant.get(p_obj.id, []),
                key=lambda w: w.position
            )

            participants_data_for_template.append({
                'obj': p_obj,
                'inscriptions_count': len(p_confirmed_inscriptions),
                'attente_count': len(p_waitlist_entries),
                'pending_count': len(p_pending_inscriptions),
                'loaded_confirmed_inscriptions': p_confirmed_inscriptions,
                'loaded_pending_inscriptions': p_pending_inscriptions,
                'loaded_waitlist': p_waitlist_entries
            })
        
        return render_template('participants.html',
                              participants_data=participants_data_for_template,
                              services=services_list_for_dropdown,
                              ListeAttente=ListeAttente, # Pass class if used for type checking in template
                              Inscription=Inscription) # Pass class if used

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading participants page: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement des participants.", "danger")
        return redirect(url_for('dashboard'))
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error loading participants page: {e}", exc_info=True)
        flash("Une erreur interne est survenue.", "danger")
        return redirect(url_for('dashboard'))


# --- Admin Only Routes ---

# --- Route /admin (Optimized v9) ---
@app.route('/admin')
@login_required
@db_operation_with_retry(max_retries=3)
def admin():
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs.', 'danger')
        return redirect(url_for('dashboard'))

    try:
        # Eager load Theme -> sessions relationship
        themes = Theme.query.options(selectinload(Theme.sessions)).order_by(Theme.nom).all()

        # Other data fetches (can use cached helpers)
        sessions = Session.query.options(
            joinedload(Session.theme), joinedload(Session.salle)
        ).order_by(Session.date, Session.heure_debut).all()
        services = get_all_services_with_participants() # Cached
        participants = get_all_participants_with_service() # Cached
        salles = get_all_salles() # Cached

        # Fetch recent activities
        activites_recentes = Activite.query.options(
            joinedload(Activite.utilisateur)
        ).order_by(Activite.date.desc()).limit(10).all() # Limit for dashboard display

        # Calculate global counts efficiently
        total_inscriptions = db.session.query(func.count(Inscription.id)).filter(Inscription.statut == 'confirmé').scalar() or 0
        total_en_attente = db.session.query(func.count(ListeAttente.id)).scalar() or 0
        total_sessions_count = db.session.query(func.count(Session.id)).scalar() or 0

        # Calculate completed sessions count (optimized query from v7)
        total_sessions_completes = 0
        session_ids = [s.id for s in sessions]
        if session_ids:
             subquery = db.session.query(
                 Inscription.session_id, func.count(Inscription.id).label('confirmed_count')
             ).filter(
                 Inscription.session_id.in_(session_ids), Inscription.statut == 'confirmé'
             ).group_by(Inscription.session_id).subquery()
             completed_sessions_q = db.session.query(Session.id).outerjoin(
                 subquery, Session.id == subquery.c.session_id
             ).filter(
                 Session.id.in_(session_ids),
                 func.coalesce(subquery.c.confirmed_count, 0) >= Session.max_participants
             ).count()
             total_sessions_completes = completed_sessions_q

        # Calculate total sessions per theme (using the eager-loaded data)
        # This avoids the DetachedInstanceError in the template
        theme_session_counts = {theme.id: len(theme.sessions) for theme in themes}

        return render_template('admin.html',
                             themes=themes, # Pass themes with sessions loaded
                             theme_session_counts=theme_session_counts, # Pass pre-calculated counts
                             sessions=sessions,
                             services=services,
                             participants=participants,
                             salles=salles,
                             total_inscriptions=total_inscriptions,
                             total_en_attente=total_en_attente,
                             total_sessions_completes=total_sessions_completes,
                             total_sessions_count=total_sessions_count,
                             activites_recentes=activites_recentes,
                             ListeAttente=ListeAttente
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


# --- Route /salles (Optimized v9) ---
@app.route('/salles', methods=['GET'])
@login_required
@db_operation_with_retry(max_retries=3)
def salles():
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs.', 'danger')
        return redirect(url_for('dashboard'))

    try:
        # Fetch salles
        salles_list = get_all_salles() # Cached

        # Fetch associated sessions efficiently
        salle_ids = [s.id for s in salles_list]
        sessions_by_salle = {}
        if salle_ids:
            sessions_q = Session.query.options(
                joinedload(Session.theme) # Load theme needed for display
            ).filter(
                Session.salle_id.in_(salle_ids)
            ).order_by(Session.date).all()
            for sess in sessions_q:
                if sess.salle_id not in sessions_by_salle:
                    sessions_by_salle[sess.salle_id] = []
                sessions_by_salle[sess.salle_id].append(sess)

        # Prepare data for template
        salles_data = []
        for s in salles_list:
            associated_sessions = sessions_by_salle.get(s.id, [])
            salles_data.append({
                'obj': s,
                'sessions_count': len(associated_sessions),
                'sessions_associees': associated_sessions # Pass loaded sessions
            })

        return render_template('salles.html', salles_data=salles_data)

    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading salles page: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement des salles.", "danger")
        return redirect(url_for('admin'))
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error loading salles page: {e}", exc_info=True)
        flash("Une erreur interne est survenue.", "danger")
        return redirect(url_for('admin'))

# --- add_salle, update_salle, delete_salle, attribuer_salle ---
@app.route('/add_salle', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def add_salle():
    if current_user.role != 'admin':
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
    redirect_url = url_for('salles')
    try:
        nom = request.form.get('nom', '').strip()
        capacite_str = request.form.get('capacite', '').strip()
        lieu = request.form.get('lieu', '').strip()
        description = request.form.get('description', '').strip()

        if not nom or not capacite_str:
            flash('Le nom et la capacité de la salle sont obligatoires.', 'danger')
            return redirect(redirect_url)
        try:
            capacite = int(capacite_str)
            if capacite <= 0: raise ValueError("Capacity must be positive")
        except ValueError:
            flash('La capacité doit être un nombre entier positif.', 'danger')
            return redirect(redirect_url)

        if Salle.query.filter(func.lower(Salle.nom) == func.lower(nom)).first():
            flash(f"Une salle nommée '{nom}' existe déjà.", 'warning')
            return redirect(redirect_url)

        salle = Salle(nom=nom, capacite=capacite, lieu=lieu or None, description=description or None)
        db.session.add(salle)
        db.session.commit()
        cache.delete('all_salles') # Invalidate cache

        add_activity('ajout_salle', f'Ajout salle: {salle.nom}',
                    f'Capacité: {salle.capacite}', user=current_user)
        flash('Salle ajoutée avec succès.', 'success')

    except IntegrityError:
        db.session.rollback()
        flash('Erreur: Une salle avec ce nom existe déjà.', 'danger')
    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de l\'ajout de la salle.', 'danger')
        app.logger.error(f"SQLAlchemyError adding salle: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Error adding salle: {e}", exc_info=True)
    return redirect(redirect_url)

@app.route('/update_salle/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def update_salle(id):
    if current_user.role != 'admin':
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
    salle = db.session.get(Salle, id)
    redirect_url = url_for('salles')
    if not salle:
        flash('Salle introuvable.', 'danger')
        return redirect(redirect_url)

    original_capacite = salle.capacite # Stocker l'ancienne capacité

    try:
        original_nom = salle.nom # Gardé de votre code original
        new_nom = request.form.get('nom', '').strip()
        capacite_str = request.form.get('capacite', '').strip()

        if not new_nom or not capacite_str:
            flash('Le nom et la capacité sont obligatoires.', 'danger')
            return redirect(redirect_url)
        try:
            capacite = int(capacite_str)
            if capacite <= 0: raise ValueError("Capacity must be positive")
        except ValueError:
            flash('La capacité doit être un nombre entier positif.', 'danger')
            return redirect(redirect_url)

        if new_nom.lower() != original_nom.lower() and Salle.query.filter(
                func.lower(Salle.nom) == func.lower(new_nom),
                Salle.id != id).first():
            flash(f"Une autre salle nommée '{new_nom}' existe déjà.", 'warning')
            return redirect(redirect_url)

        salle.nom = new_nom
        salle.capacite = capacite # Nouvelle capacité
        salle.lieu = request.form.get('lieu', '').strip() or None
        salle.description = request.form.get('description', '').strip() or None
        
        db.session.commit() # Sauvegarder les changements de la salle

        # *** NOUVELLE PARTIE : Mettre à jour les sessions associées ***
        if salle.capacite != original_capacite:
            updated_session_count = 0
            # salle.sessions est la relation backref définie dans le modèle Salle
            for session_associee in salle.sessions: 
                session_associee.max_participants = salle.capacite
                updated_session_count +=1
            
            if updated_session_count > 0:
                db.session.commit() # Sauvegarder les changements des sessions
                app.logger.info(f"Mis à jour max_participants pour {updated_session_count} sessions liées à la salle '{salle.nom}' à {salle.capacite}.")
        # *** FIN NOUVELLE PARTIE ***

        cache.delete('all_salles') 

        add_activity('modification_salle', f'Modification salle: {salle.nom}', user=current_user)
        flash('Salle mise à jour avec succès. Les sessions associées ont également été mises à jour.', 'success') # Message modifié

    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de la mise à jour.', 'danger')
        app.logger.error(f"SQLAlchemyError updating salle {id}: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Error updating salle {id}: {e}", exc_info=True)
    return redirect(redirect_url)

@app.route('/delete_salle/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def delete_salle(id):
    if current_user.role != 'admin':
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
    salle = db.session.get(Salle, id)
    redirect_url = url_for('salles')
    if not salle:
        flash('Salle introuvable.', 'danger')
        return redirect(redirect_url)
    try:
        # Check if any sessions are assigned to this room
        sessions_associees_count = db.session.query(func.count(Session.id)).filter(
            Session.salle_id == id).scalar() or 0
        if sessions_associees_count > 0:
            flash(f'Impossible de supprimer "{salle.nom}", {sessions_associees_count} session(s) y sont encore associées. Veuillez d\'abord réassigner ces sessions.', 'danger')
            return redirect(redirect_url)

        nom_salle = salle.nom
        db.session.delete(salle)
        db.session.commit()
        cache.delete('all_salles') # Invalidate cache

        add_activity('suppression_salle', f'Suppression salle: {nom_salle}', user=current_user)
        flash(f'Salle "{nom_salle}" supprimée avec succès.', 'success')

    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de la suppression.', 'danger')
        app.logger.error(f"SQLAlchemyError deleting salle {id}: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue lors de la suppression.', 'danger')
        app.logger.error(f"Error deleting salle {id}: {e}", exc_info=True)
    return redirect(redirect_url)

@app.route('/attribuer_salle', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def attribuer_salle():
    if current_user.role != 'admin':
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
    redirect_url = request.referrer or url_for('admin')
    try:
        session_id = request.form.get('session_id', type=int)
        salle_id_str = request.form.get('salle_id', '').strip()

        if not session_id:
            flash('ID de session manquant.', 'danger')
            return redirect(redirect_url)

        session = db.session.get(Session, session_id)
        if not session:
            flash('Session introuvable.', 'danger')
            return redirect(redirect_url)

        new_salle_id = None
        new_salle_nom = "Aucune"
        new_salle_capacite = 10 # Valeur par défaut si aucune salle n'est sélectionnée (ou votre ancien défaut 15)

        if salle_id_str:
            try:
                new_salle_id = int(salle_id_str)
                new_salle = db.session.get(Salle, new_salle_id) # Récupérer l'objet Salle
                if not new_salle:
                    flash(f"Salle avec ID {new_salle_id} introuvable.", 'danger')
                    return redirect(redirect_url)
                new_salle_nom = new_salle.nom
                new_salle_capacite = new_salle.capacite # *** Utiliser la capacité de la salle assignée ***
            except ValueError:
                flash("ID de salle invalide.", 'danger')
                return redirect(redirect_url)

        session.salle_id = new_salle_id
        session.max_participants = new_salle_capacite # *** Mettre à jour max_participants de la session ***
        db.session.commit()

        add_activity('attribution_salle', f'Attribution salle: {new_salle_nom} (Cap: {new_salle_capacite})', # Log avec capacité
                    f'Session: {session.theme.nom} ({session.formatage_date})', user=current_user)
        flash(f'Salle "{new_salle_nom}" attribuée à la session. Capacité mise à {new_salle_capacite} places.', 'success') # Message modifié

        socketio.emit('attribution_salle', {
            'session_id': session_id,
            'salle_id': new_salle_id,
            'salle_nom': new_salle_nom if new_salle_id else None,
            'max_participants': new_salle_capacite # Envoyer la nouvelle capacité via socket
        }, room='general')

    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de l\'attribution.', 'danger')
        app.logger.error(f"SQLAlchemyError assigning salle: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Error assigning salle: {e}", exc_info=True)
    return redirect(redirect_url)


# --- Route /themes (Optimized v9 - Fix DetachedInstanceError) ---
@app.route('/themes', methods=['GET'])
@login_required
@db_operation_with_retry(max_retries=3)
def themes():
    """Displays themes and their associated sessions for admin management."""
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs.', 'danger')
        return redirect(url_for('dashboard'))

    app.logger.debug(f"User '{current_user.username}' accessing /themes route.")
    
    try:
        # Eager load Theme -> sessions -> salle/theme relationships using selectinload
        # selectinload is often better for one-to-many relationships like Theme->sessions
        themes_list = Theme.query.options(
            selectinload(Theme.sessions).selectinload(Session.salle),
            selectinload(Theme.sessions).selectinload(Session.theme) # Load session's theme too
        ).order_by(Theme.nom).all()
        
        app.logger.info(f"Fetched {len(themes_list)} themes from database for /themes page.")
        if not themes_list:
             app.logger.warning("No themes found in the database.")
             # Render template even if no themes, template should handle empty list
             return render_template('themes.html', themes_data=[])

        # Get all session IDs from the loaded themes to optimize the inscription count query
        all_session_ids = [s.id for theme_obj in themes_list for s in theme_obj.sessions]
        app.logger.debug(f"Found {len(all_session_ids)} associated session IDs across all themes.")

        confirmed_counts_by_session = {}
        if all_session_ids:
            # Fetch confirmed inscription counts for all relevant sessions in one efficient query
            try:
                confirmed_q = db.session.query(
                    Inscription.session_id, func.count(Inscription.id)
                ).filter(
                    Inscription.session_id.in_(all_session_ids),
                    Inscription.statut == 'confirmé'
                ).group_by(Inscription.session_id).all()
                confirmed_counts_by_session = dict(confirmed_q)
                app.logger.debug(f"Fetched confirmed inscription counts for {len(confirmed_counts_by_session)} sessions.")
            except SQLAlchemyError as count_err:
                 db.session.rollback() # Rollback on count query error
                 app.logger.error(f"DB error fetching inscription counts for sessions: {count_err}", exc_info=True)
                 # Decide how to proceed: maybe show themes without counts or show error page
                 flash("Erreur lors de la récupération des comptes d'inscriptions.", "warning")
                 # Continue processing themes but counts might be missing/zero

        # Prepare the final data structure for the template
        themes_data_for_template = []
        for theme_obj in themes_list:
            session_details_list = []
            # Sort the already loaded sessions associated with this theme by date
            # Use a very old date as fallback if session.date is None (shouldn't happen ideally)
            sorted_sessions = sorted(
                theme_obj.sessions, 
                key=lambda s: s.date if s.date else date.min 
            )

            for session_obj in sorted_sessions:
                try:
                    # Get the pre-calculated confirmed count, default to 0 if not found or error occurred
                    confirmed_count = confirmed_counts_by_session.get(session_obj.id, 0)
                    
                    # Calculate remaining places safely
                    places_restantes = max(0, (session_obj.max_participants or 0) - confirmed_count)
                    
                    session_details_list.append({
                        'obj': session_obj, # Pass the full session object
                        'confirmed_count': confirmed_count,
                        'places_restantes': places_restantes
                    })
                except AttributeError as attr_err:
                     # Catch potential errors if session object structure is unexpected
                     app.logger.error(f"Attribute error processing session {session_obj.id} for theme '{theme_obj.nom}': {attr_err}", exc_info=True)
                     session_details_list.append({ 'obj': session_obj, 'confirmed_count': -1, 'places_restantes': 0, 'error': True })
                except Exception as proc_err:
                    # Catch any other unexpected error during session processing
                    app.logger.error(f"Unexpected error processing session {session_obj.id} for theme '{theme_obj.nom}': {proc_err}", exc_info=True)
                    # Add placeholder to avoid breaking loop, mark as error
                    session_details_list.append({ 'obj': session_obj, 'confirmed_count': -1, 'places_restantes': 0, 'error': True })


            themes_data_for_template.append({
                'obj': theme_obj, # The theme object itself
                'sessions_detailed': session_details_list, # List of session dicts with counts
                'total_sessions': len(theme_obj.sessions) # Total sessions for this theme
            })

        app.logger.info(f"Successfully prepared data for {len(themes_data_for_template)} themes to render.")
        # Pass the processed data to the template
        # Ensure your template 'themes.html' iterates through 'themes_data'
        return render_template('themes.html', themes_data=themes_data_for_template)

    except SQLAlchemyError as e:
        # Handle database errors during the main theme query or commit (if any)
        db.session.rollback() # Rollback any potential transaction state
        app.logger.error(f"DB error loading themes page: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement des thèmes.", "danger")
        # Redirect to admin dashboard or a dedicated error page
        return redirect(url_for('admin')) 
    except Exception as e:
        # Handle any other unexpected errors
        db.session.rollback() # Rollback just in case
        app.logger.error(f"Unexpected error loading themes page: {e}", exc_info=True)
        flash("Une erreur interne est survenue lors du chargement des thèmes.", "danger")
        return redirect(url_for('admin'))


# --- add_theme, update_theme ---
@app.route('/add_theme', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def add_theme():
    if current_user.role != 'admin':
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
    redirect_url = url_for('themes')
    try:
        nom = request.form.get('nom', '').strip()
        description = request.form.get('description', '').strip()

        if not nom:
            flash('Le nom du thème est obligatoire.', 'danger')
            return redirect(redirect_url)

        if Theme.query.filter(func.lower(Theme.nom) == func.lower(nom)).first():
            flash(f"Un thème nommé '{nom}' existe déjà.", 'warning')
            return redirect(redirect_url)

        theme = Theme(nom=nom, description=description or None)
        db.session.add(theme)
        db.session.commit()
        cache.delete('all_themes') # Invalidate cache

        add_activity('ajout_theme', f'Ajout thème: {theme.nom}', user=current_user)
        flash('Thème ajouté avec succès.', 'success')

    except IntegrityError:
        db.session.rollback()
        flash('Erreur: Un thème avec ce nom existe déjà.', 'danger')
    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de l\'ajout du thème.', 'danger')
        app.logger.error(f"SQLAlchemyError adding theme: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Error adding theme: {e}", exc_info=True)
    return redirect(redirect_url)

@app.route('/update_theme/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def update_theme(id):
    if current_user.role != 'admin':
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
    theme = db.session.get(Theme, id)
    redirect_url = url_for('themes')
    if not theme:
        flash('Thème introuvable.', 'danger')
        return redirect(redirect_url)
    try:
        original_nom = theme.nom
        new_nom = request.form.get('nom', '').strip()

        if not new_nom:
            flash('Le nom du thème est obligatoire.', 'danger')
            return redirect(redirect_url)

        # Check for name conflict
        if new_nom.lower() != original_nom.lower() and Theme.query.filter(
                func.lower(Theme.nom) == func.lower(new_nom),
                Theme.id != id).first():
            flash(f"Un autre thème nommé '{new_nom}' existe déjà.", 'warning')
            return redirect(redirect_url)

        theme.nom = new_nom
        theme.description = request.form.get('description', '').strip() or None
        db.session.commit()
        cache.delete('all_themes') # Invalidate cache

        add_activity('modification_theme', f'Modification thème: {theme.nom}', user=current_user)
        flash('Thème mis à jour avec succès.', 'success')

    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de la mise à jour.', 'danger')
        app.logger.error(f"SQLAlchemyError updating theme {id}: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Error updating theme {id}: {e}", exc_info=True)
    return redirect(redirect_url)

@app.route('/delete_theme/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def delete_theme(id):
    """Deletes a theme and its associated sessions (Admin only)."""
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs.', 'danger')
        return redirect(url_for('dashboard')) # Or 'themes' if preferred

    theme = db.session.get(Theme, id)
    redirect_url = url_for('themes')

    if not theme:
        flash('Thème introuvable.', 'danger')
        return redirect(redirect_url)

    try:
        theme_name = theme.nom
        
        # Note: SQLAlchemy's cascade="all, delete-orphan" on the Theme.sessions 
        # relationship should automatically delete associated sessions when the theme is deleted.
        # If cascade is not set, you would need to delete sessions manually first:
        # Session.query.filter_by(theme_id=id).delete() 
        # Make sure your Theme model has the cascade option set correctly on the sessions relationship.

        db.session.delete(theme)
        db.session.commit()

        # Invalidate theme cache
        cache.delete('all_themes') 

        add_activity('suppression_theme', f'Suppression thème: {theme_name}', 
                     'Toutes les sessions associées ont également été supprimées.', user=current_user)
        
        flash(f'Thème "{theme_name}" et ses sessions associées ont été supprimés avec succès.', 'success')

    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de la suppression du thème.', 'danger')
        app.logger.error(f"SQLAlchemyError deleting theme {id}: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue lors de la suppression du thème.', 'danger')
        app.logger.error(f"Error deleting theme {id}: {e}", exc_info=True)

    return redirect(redirect_url)
    
# --- add_service, update_service ---
@app.route('/add_service', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def add_service():
    if current_user.role != 'admin':
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
    redirect_url = url_for('services')
    try:
        service_id = request.form.get('id', '').strip().lower()
        nom = request.form.get('nom', '').strip()
        responsable = request.form.get('responsable', '').strip()
        email_responsable = request.form.get('email_responsable', '').strip().lower()
        couleur = request.form.get('couleur', '#6c757d').strip()

        if not all([service_id, nom, responsable, email_responsable]):
            flash('Tous les champs marqués * sont obligatoires.', 'danger')
            return redirect(redirect_url)
        # Basic validation for ID format (lowercase, no spaces)
        if not service_id.islower() or ' ' in service_id:
             flash("L'ID Service doit être en minuscules, sans espaces.", 'warning')
             return redirect(redirect_url)

        if Service.query.filter_by(id=service_id).first():
            flash(f"Un service avec l'ID '{service_id}' existe déjà.", 'warning')
            return redirect(redirect_url)
        if Service.query.filter(func.lower(Service.nom) == func.lower(nom)).first():
            flash(f"Un service nommé '{nom}' existe déjà.", 'warning')
            return redirect(redirect_url)

        service = Service(id=service_id, nom=nom, responsable=responsable,
                         email_responsable=email_responsable, couleur=couleur or '#6c757d')
        db.session.add(service)
        db.session.commit()
        cache.delete('all_services_with_participants') # Invalidate cache

        add_activity('ajout_service', f'Ajout service: {service.nom}', user=current_user)
        flash('Service ajouté avec succès.', 'success')

    except IntegrityError as ie:
        db.session.rollback()
        flash('Erreur: ID ou Nom de service déjà existant.', 'danger')
        app.logger.error(f"IntegrityError adding service: {ie}")
    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de l\'ajout du service.', 'danger')
        app.logger.error(f"SQLAlchemyError adding service: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Error adding service: {e}", exc_info=True)
    return redirect(redirect_url)

@app.route('/update_service/<service_id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def update_service(service_id):
    if current_user.role != 'admin':
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
    service = db.session.get(Service, service_id)
    redirect_url = url_for('services')
    if not service:
        flash('Service introuvable.', 'danger')
        return redirect(redirect_url)
    try:
        original_nom = service.nom
        new_nom = request.form.get('nom', '').strip()
        new_responsable = request.form.get('responsable', '').strip()
        new_email = request.form.get('email_responsable', '').strip().lower()
        new_couleur = request.form.get('couleur', '#6c757d').strip()

        if not all([new_nom, new_responsable, new_email]):
            flash('Nom, Responsable et Email Responsable sont obligatoires.', 'danger')
            return redirect(redirect_url)

        # Check for name conflict
        if new_nom.lower() != original_nom.lower() and Service.query.filter(
                func.lower(Service.nom) == func.lower(new_nom),
                Service.id != service_id).first():
            flash(f"Un autre service nommé '{new_nom}' existe déjà.", 'warning')
            return redirect(redirect_url)

        service.nom = new_nom
        service.responsable = new_responsable
        service.email_responsable = new_email
        service.couleur = new_couleur or '#6c757d'
        db.session.commit()
        cache.delete('all_services_with_participants') # Invalidate cache
        cache.delete(f'service_participant_count_{service_id}') # Invalidate specific count if used

        add_activity('modification_service', f'Modif service: {service.nom}', user=current_user)
        flash('Service mis à jour avec succès.', 'success')

    except SQLAlchemyError as e:
        db.session.rollback()
        flash('Erreur de base de données lors de la mise à jour.', 'danger')
        app.logger.error(f"SQLAlchemyError updating service {service_id}: {e}", exc_info=True)
    except Exception as e:
        db.session.rollback()
        flash('Une erreur inattendue est survenue.', 'danger')
        app.logger.error(f"Error updating service {service_id}: {e}", exc_info=True)
    return redirect(redirect_url)

# --- Route /activites (Optimized v9) ---
@app.route('/activites')
@login_required
def activites():
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs.', 'danger')
        return redirect(url_for('dashboard'))

    try:
        page = request.args.get('page', 1, type=int)
        per_page = 25 # Increase items per page slightly
        type_filter = request.args.get('type', '').strip()

        # Base query with eager loading of the user
        query = Activite.query.options(joinedload(Activite.utilisateur))

        if type_filter:
            query = query.filter(Activite.type == type_filter)

        # Paginate the results
        activites_pagination = query.order_by(Activite.date.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )

        return render_template('activites.html',
                              activites=activites_pagination,
                              type_filter=type_filter) # Pass filter back for UI state

    except SQLAlchemyError as e:
        # No rollback needed for SELECT query error usually
        app.logger.error(f"DB error loading activities page: {e}", exc_info=True)
        flash("Erreur de base de données lors du chargement du journal.", "danger")
        return redirect(url_for('admin'))
    except Exception as e:
        app.logger.error(f"Unexpected error loading activities page: {e}", exc_info=True)
        flash("Une erreur interne est survenue.", "danger")
        return redirect(url_for('admin'))


@app.route('/api/dashboard_essential')
@db_operation_with_retry(max_retries=2)  # Fewer retries for API
def api_dashboard_essential():
    """API combinée pour les données essentielles du dashboard."""
    try:
        # Fetch sessions with necessary relationships
        sessions_q = Session.query.options(
            joinedload(Session.theme),
            joinedload(Session.salle)
        ).order_by(Session.date, Session.heure_debut).all()

        # Fetch recent activities
        activites_q = Activite.query.options(
            joinedload(Activite.utilisateur)
        ).order_by(Activite.date.desc()).limit(5).all()  # Limit to 5 for dashboard

        # Prepare session data with counts (use cache if available)
        sessions_data = []
        for s in sessions_q:
            cache_key = f'session_counts_{s.id}'
            session_counts = cache.get(cache_key)
            if session_counts is None:
                inscrits_count = db.session.query(func.count(Inscription.id)).filter(
                    Inscription.session_id == s.id, Inscription.statut == 'confirmé'
                ).scalar() or 0
                attente_count = db.session.query(func.count(ListeAttente.id)).filter(
                    ListeAttente.session_id == s.id
                ).scalar() or 0
                pending_count = db.session.query(func.count(Inscription.id)).filter(
                    Inscription.session_id == s.id, Inscription.statut == 'en attente'
                ).scalar() or 0
                places_rest = max(0, s.max_participants - inscrits_count)
                session_counts = {
                    'inscrits_confirmes_count': inscrits_count,
                    'liste_attente_count': attente_count,
                    'pending_count': pending_count,
                    'places_restantes': places_rest
                }
                cache.set(cache_key, session_counts, timeout=60)
            else:
                # Ensure pending count exists if loaded from cache
                if 'pending_count' not in session_counts:
                    session_counts['pending_count'] = db.session.query(func.count(Inscription.id)).filter(
                        Inscription.session_id == s.id, Inscription.statut == 'en attente'
                    ).scalar() or 0

            sessions_data.append({
                'id': s.id,
                'date': s.formatage_date,
                'horaire': s.formatage_horaire,
                'theme': s.theme.nom if s.theme else 'N/A',
                'theme_id': s.theme_id,
                'places_restantes': session_counts['places_restantes'],
                'inscrits': session_counts['inscrits_confirmes_count'],
                'max_participants': s.max_participants,
                'liste_attente': session_counts['liste_attente_count'],
                'pending_count': session_counts['pending_count'],  # Ajoutez ce champ
                'salle': s.salle.nom if s.salle else None,
                'salle_id': s.salle_id
            })

        # Prepare activity data
        activites_data = [{
            'id': a.id, 'type': a.type, 'description': a.description,
            'details': a.details, 'date_relative': a.date_relative,
            'user': a.utilisateur.username if a.utilisateur else None
        } for a in activites_q]

        # IMPORTANT: Assurez-vous que sessions_data est un tableau et pas un objet
        # C'est le format attendu par polling-updates.js
        return jsonify({
            'sessions': sessions_data,  # Ceci est bien un tableau
            'activites': activites_data,
            'timestamp': datetime.now(UTC).timestamp()
        })

    except SQLAlchemyError as e:
        # No rollback needed for SELECT
        app.logger.error(f"API DB Error in dashboard_essential: {e}", exc_info=True)
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        app.logger.error(f"API Unexpected Error in dashboard_essential: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500
        
@app.route('/api/sessions')
@limiter.limit("30 per minute")
@db_operation_with_retry(max_retries=2)
def api_sessions():
    try:
        # Paramètres de pagination
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        date_filter = request.args.get('date')
        
        # Cache key avec pagination et filtres
        cache_key = f'sessions_page_{page}_size_{per_page}_date_{date_filter}'
        cached_result = cache.get(cache_key)
        
        if cached_result:
            return jsonify(cached_result)
        
        # Construire la requête de base
        query = Session.query.options(
            joinedload(Session.theme),
            joinedload(Session.salle)
        )
        
        # Filtrer par date si spécifié
        if date_filter:
            try:
                filter_date = datetime.strptime(date_filter, '%Y-%m-%d').date()
                query = query.filter(Session.date == filter_date)
            except ValueError:
                pass  # Ignorer si format de date invalide
        
        # Paginer les résultats
        pagination = query.order_by(Session.date, Session.heure_debut).paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        # Récupérer tous les IDs de session pour les comptages en masse
        session_ids = [s.id for s in pagination.items]
        
        if session_ids:
            # Compter toutes les inscriptions confirmées en une seule requête
            confirmed_counts = dict(
                db.session.query(
                    Inscription.session_id,
                    func.count(Inscription.id)
                ).filter(
                    Inscription.session_id.in_(session_ids),
                    Inscription.statut == 'confirmé'
                ).group_by(Inscription.session_id).all()
            )
            
            # Compter toutes les listes d'attente en une seule requête
            waitlist_counts = dict(
                db.session.query(
                    ListeAttente.session_id,
                    func.count(ListeAttente.id)
                ).filter(
                    ListeAttente.session_id.in_(session_ids)
                ).group_by(ListeAttente.session_id).all()
            )
        else:
            confirmed_counts = {}
            waitlist_counts = {}
        
        # Préparer le résultat
        result = []
        for s in pagination.items:
            inscrits_count = confirmed_counts.get(s.id, 0)
            attente_count = waitlist_counts.get(s.id, 0)
            places_rest = max(0, s.max_participants - inscrits_count)
            
            # Mettre en cache les comptages individuels pour 5 minutes
            session_cache_key = f'session_counts_{s.id}'
            session_counts = {
                'inscrits_confirmes_count': inscrits_count,
                'liste_attente_count': attente_count,
                'places_restantes': places_rest
            }
            cache.set(session_cache_key, session_counts, timeout=300)
            
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
        
        # Structure avec métadonnées de pagination
        response_data = {
            'items': result,
            'total': pagination.total,
            'pages': pagination.pages,
            'page': pagination.page,
            'per_page': pagination.per_page
        }
        
        # Cache pour 30 secondes (sessions peuvent changer plus souvent que participants)
        cache.set(cache_key, response_data, timeout=30)
        
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
        db.session.close()
@app.route('/api/sessions/<int:session_id>')
@db_operation_with_retry(max_retries=2)
def api_single_session(session_id):
    # (Implementation from v7)
    try:
        session = db.session.get(Session, session_id)
        if not session:
            return jsonify({"error": "Session not found"}), 404

        # Use cached counts if available, otherwise calculate
        cache_key = f'session_counts_{session_id}'
        session_counts = cache.get(cache_key)
        if session_counts is None:
            inscrits_count = db.session.query(func.count(Inscription.id)).filter(
                Inscription.session_id == session_id, Inscription.statut == 'confirmé'
            ).scalar() or 0
            attente_count = db.session.query(func.count(ListeAttente.id)).filter(
                ListeAttente.session_id == session_id
            ).scalar() or 0
            pending_count = db.session.query(func.count(Inscription.id)).filter(
                Inscription.session_id == session_id, Inscription.statut == 'en attente'
            ).scalar() or 0
            places_rest = max(0, session.max_participants - inscrits_count)
            session_counts = {
                'inscrits_confirmes_count': inscrits_count,
                'liste_attente_count': attente_count,
                'pending_count': pending_count,
                'places_restantes': places_rest
            }
            cache.set(cache_key, session_counts, timeout=60)
        else:
            # Ensure pending count exists if loaded from cache
            if 'pending_count' not in session_counts:
                 session_counts['pending_count'] = db.session.query(func.count(Inscription.id)).filter(
                     Inscription.session_id == session_id, Inscription.statut == 'en attente'
                 ).scalar() or 0

        # Fetch details efficiently
        inscrits_details_q = db.session.query(
            Inscription.id, Participant.prenom, Participant.nom, Inscription.statut
        ).join(Participant).filter(Inscription.session_id == session_id).all()

        attente_details_q = db.session.query(
            ListeAttente.id, Participant.prenom, Participant.nom, ListeAttente.position
        ).join(Participant).filter(ListeAttente.session_id == session_id).order_by(ListeAttente.position).all()

        result = {
            'id': session.id,
            'date': session.formatage_date, 'iso_date': session.date.isoformat(),
            'horaire': session.formatage_horaire,
            'theme': session.theme.nom if session.theme else 'N/A', 'theme_id': session.theme_id,
            'places_restantes': session_counts['places_restantes'],
            'inscrits': session_counts['inscrits_confirmes_count'],
            'max_participants': session.max_participants,
            'liste_attente': session_counts['liste_attente_count'],
            'pending_count': session_counts.get('pending_count', 0), # Use .get
            'salle': session.salle.nom if session.salle else None, 'salle_id': session.salle_id,
            'inscriptions_details': [
                {'id': i.id, 'participant': f"{i.prenom} {i.nom}", 'statut': i.statut}
                for i in inscrits_details_q
            ],
            'liste_attente_details': [
                {'id': l.id, 'participant': f"{l.prenom} {l.nom}", 'position': l.position}
                for l in attente_details_q
            ]
        }
        return jsonify(result)

    except SQLAlchemyError as e:
        app.logger.error(f"API Error session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        app.logger.error(f"API Unexpected Error session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/participants')
@limiter.limit("30 per minute")
@db_operation_with_retry(max_retries=2)
def api_participants():
    try:
        # Récupérer les paramètres de pagination
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        
        # Cache key avec pagination
        cache_key = f'participants_page_{page}_size_{per_page}'
        cached_result = cache.get(cache_key)
        
        if cached_result:
            return jsonify(cached_result)
        
        # Requête paginée
        pagination = Participant.query.options(
            joinedload(Participant.service)
        ).order_by(Participant.nom, Participant.prenom).paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        # Construire la liste des IDs pour récupérer toutes les statistiques en une seule requête
        participant_ids = [p.id for p in pagination.items]
        
        # Sous-requêtes optimisées avec union all pour minimiser les allers-retours
        if participant_ids:
            # Compter les inscriptions confirmées par participant en une seule requête
            confirmed_counts = dict(
                db.session.query(
                    Inscription.participant_id,
                    func.count(Inscription.id)
                ).filter(
                    Inscription.participant_id.in_(participant_ids),
                    Inscription.statut == 'confirmé'
                ).group_by(Inscription.participant_id).all()
            )
            
            # Compter les listes d'attente par participant en une seule requête
            waitlist_counts = dict(
                db.session.query(
                    ListeAttente.participant_id,
                    func.count(ListeAttente.id)
                ).filter(
                    ListeAttente.participant_id.in_(participant_ids)
                ).group_by(ListeAttente.participant_id).all()
            )
        else:
            confirmed_counts = {}
            waitlist_counts = {}
        
        # Construire le résultat
        result = []
        for p in pagination.items:
            result.append({
                'id': p.id,
                'nom': p.nom,
                'prenom': p.prenom,
                'email': p.email,
                'service': p.service.nom if p.service else 'N/A',
                'service_id': p.service_id,
                'inscriptions': confirmed_counts.get(p.id, 0),
                'en_attente': waitlist_counts.get(p.id, 0)
            })
        
        # Structure du résultat avec métadonnées de pagination
        response_data = {
            'items': result,
            'total': pagination.total,
            'pages': pagination.pages,
            'page': pagination.page,
            'per_page': pagination.per_page
        }
        
        # Mettre en cache pour 60 secondes
        cache.set(cache_key, response_data, timeout=60)
        
        return jsonify(response_data)
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"API Error fetching participants: {e}", exc_info=True)
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"API Unexpected Error fetching participants: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500
    finally:
        db.session.close()
@app.route('/api/salles')
@db_operation_with_retry(max_retries=2)
def api_salles():
    # (Implementation from v8)
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

@app.route('/api/activites')
@db_operation_with_retry(max_retries=2)
def api_activites():
    # (Implementation from v8)
    try:
        limit = request.args.get('limit', 10, type=int)
        activites = Activite.query.options(joinedload(Activite.utilisateur)).order_by(Activite.date.desc()).limit(limit).all()
        result = [{
            'id': a.id, 'type': a.type, 'description': a.description,
            'details': a.details, 'date_relative': a.date_relative,
            'date_iso': a.date.isoformat(),
            'user': a.utilisateur.username if a.utilisateur else None
        } for a in activites]
        return jsonify(result)
    except SQLAlchemyError as e:
        app.logger.error(f"API Error fetching activities: {e}", exc_info=True)
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        app.logger.error(f"API Unexpected Error fetching activities: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/generer_invitation/<int:inscription_id>')
# @login_required # Supprimé comme demandé pour permettre aux non-connectés de télécharger
@db_operation_with_retry(max_retries=2) # Moins de tentatives pour une route de téléchargement
def generer_invitation(inscription_id):
    """Génère et sert un fichier ICS pour une inscription donnée."""
    user_info_for_log = f"User '{current_user.username}'" if current_user.is_authenticated else "Unauthenticated user"
    app.logger.info(f"{user_info_for_log} requesting invitation for inscription_id: {inscription_id}.")
    
    try:
        # Pré-charger toutes les relations nécessaires en une seule fois
        inscription = db.session.query(Inscription).options(
            joinedload(Inscription.session).options(
                joinedload(Session.theme), # Le thème de la session
                joinedload(Session.salle)  # La salle de la session
            ),
            joinedload(Inscription.participant).selectinload(Participant.service) # Le participant et son service
        ).get(inscription_id)

        if not inscription:
            app.logger.warning(f"generer_invitation: Inscription {inscription_id} not found.")
            flash('Lien d\'invitation invalide ou inscription introuvable.', 'danger')
            return redirect(request.referrer or url_for('dashboard')) # Rediriger vers la page précédente ou dashboard
        
        # Vérifications critiques sur les objets chargés
        if not inscription.session:
            app.logger.error(f"generer_invitation: Session object missing for inscription {inscription_id}.")
            flash('Données de session manquantes pour cette inscription. Impossible de générer l\'invitation.', 'danger')
            return redirect(request.referrer or url_for('dashboard'))
        if not inscription.participant:
            app.logger.error(f"generer_invitation: Participant object missing for inscription {inscription_id}.")
            flash('Données du participant manquantes pour cette inscription. Impossible de générer l\'invitation.', 'danger')
            return redirect(request.referrer or url_for('dashboard'))
        if not inscription.session.theme or not inscription.session.theme.nom:
            app.logger.error(f"generer_invitation: Theme or theme name missing for session {inscription.session.id} (inscription {inscription_id}).")
            flash('Données du thème manquantes pour cette session. Impossible de générer l\'invitation.', 'danger')
            return redirect(request.referrer or url_for('dashboard'))

        # Vérifier si l'inscription est confirmée
        if inscription.statut != 'confirmé':
            app.logger.info(f"generer_invitation: Attempt to generate ICS for non-confirmed inscription {inscription_id} (status: {inscription.statut}).")
            flash('L\'invitation n\'est disponible que pour les inscriptions confirmées.', 'warning')
            return redirect(request.referrer or url_for('dashboard'))

        session_obj = inscription.session
        participant_obj = inscription.participant
        salle_obj = session_obj.salle # Peut être None, géré dans generate_ics

        # Appel de la fonction de génération ICS
        ics_content = generate_ics(session_obj, participant_obj, salle_obj)
        
        if ics_content is None:
            app.logger.error(f"generer_invitation: ICS content generation returned None for inscription {inscription_id}.")
            flash('Une erreur est survenue lors de la création du fichier d\'invitation. Veuillez réessayer ou contacter un administrateur.', 'danger')
            return redirect(request.referrer or url_for('dashboard'))

        # Log de l'activité si un admin/responsable génère l'invitation (et que ce n'est pas pour lui-même)
        if current_user.is_authenticated and current_user.email != participant_obj.email:
            add_activity(
                type='telecharger_invitation',
                description=f'Invitation ICS téléchargée pour : {participant_obj.prenom} {participant_obj.nom}',
                details=f'Session : {session_obj.theme.nom} du {session_obj.formatage_date}. Généré par : {current_user.username}.',
                user=current_user
            )

        # Préparation du nom de fichier sécurisé
        safe_theme_name = "".join(c if c.isalnum() or c in " -" else "_" for c in session_obj.theme.nom)
        filename = f"Formation_{safe_theme_name.replace(' ', '_')}_{session_obj.date.strftime('%Y%m%d')}.ics"
        
        response = make_response(ics_content)
        response.headers["Content-Disposition"] = f"attachment; filename=\"{filename}\""
        response.headers["Content-Type"] = "text/calendar; charset=utf-8"
        app.logger.info(f"Successfully served ICS file '{filename}' for inscription {inscription_id}.")
        return response

    except SQLAlchemyError as e:
        db.session.rollback() # S'assurer de rollback en cas d'erreur DB
        app.logger.error(f"DB error in generer_invitation for inscription {inscription_id}: {e}", exc_info=True)
        flash("Erreur de base de données lors de la tentative de génération de l'invitation.", "danger")
    except AttributeError as ae: # Pour attraper les erreurs si un objet attendu est None
        app.logger.error(f"AttributeError in generer_invitation for inscription {inscription_id}: {ae}", exc_info=True)
        flash("Des données essentielles sont manquantes pour générer cette invitation. Veuillez contacter un administrateur.", 'danger')
    except Exception as e:
        app.logger.error(f"Unexpected error in generer_invitation for inscription {inscription_id}: {e}", exc_info=True)
        flash("Une erreur inattendue est survenue lors de la génération de l'invitation.", "danger")


# === Database Initialization ===
# (Keep init_db largely same as v7)
def init_db():
    with app.app_context():
        try:
            app.logger.info("Vérification et initialisation de la base de données...")
            # Check connection before proceeding
            if not check_db_connection():
                app.logger.error("Échec de la connexion à la base de données pendant l'initialisation.")
                return False

            db.create_all() # Ensure all tables exist

            # --- Initialize Services ---
            if Service.query.count() == 0:
                app.logger.info("Initialisation des services...")
                services_data = [
                    {'id':'commerce', 'nom':'Commerce Anecoop-Solagora', 'couleur':'#FFC107', 'responsable':'Andreu MIR SOLAGORA', 'email_responsable':'amir@solagora.com'},
                    {'id':'comptabilite', 'nom':'Comptabilité', 'couleur':'#2196F3', 'responsable':'Lisa VAN SCHOORISSE', 'email_responsable':'lvanschoorisse@anecoop-france.com'},
                    {'id':'florensud', 'nom':'Florensud', 'couleur':'#4CAF50', 'responsable':'Antoine LAMY', 'email_responsable':'a.lamy@florensud.fr'},
                    {'id':'informatique', 'nom':'Informatique', 'couleur':'#607D8B', 'responsable':'Kevin BIVIA', 'email_responsable':'kbivia@anecoop-france.com'}, # Corrected name
                    {'id':'marketing', 'nom':'Marketing', 'couleur':'#9C27B0', 'responsable':'Camille BROUSSOUX', 'email_responsable':'cbroussoux@anecoop-france.com'},
                    {'id':'qualite', 'nom':'Qualité', 'couleur':'#F44336', 'responsable':'Elodie PHILIBERT', 'email_responsable':'ephilibert@anecoop-france.com'}, # Use 'Elodie'
                    {'id':'rh', 'nom':'RH', 'couleur':'#FF9800', 'responsable':'Elisabeth GOMEZ', 'email_responsable':'egomez@anecoop-france.com'}
                ]
                for data in services_data:
                    db.session.add(Service(**data))
                db.session.commit()
                app.logger.info(f"{len(services_data)} services ajoutés.")
            else:
                app.logger.info("Services déjà présents.")

            # --- Initialize Salles ---
            if Salle.query.count() == 0:
                app.logger.info("Initialisation des salles...")
                # Add only 'Salle Tramontane' as per user's SQL script result
                salle_tramontane = Salle(
                    nom='Salle Tramontane',
                    capacite=15,
                    lieu='Bâtiment A, RDC',
                    description='Salle de formation polyvalente'
                )
                db.session.add(salle_tramontane)
                db.session.commit()
                app.logger.info("Salle 'Salle Tramontane' ajoutée.")
            else:
                 # Ensure Tramontane exists and is correct based on user's SQL
                 tramontane = Salle.query.filter_by(nom='Salle Tramontane').first()
                 if tramontane:
                     if tramontane.capacite != 15 or tramontane.lieu != 'Bâtiment A, RDC':
                         tramontane.capacite = 15
                         tramontane.lieu = 'Bâtiment A, RDC'
                         tramontane.description = 'Salle de formation polyvalente'
                         db.session.commit()
                         app.logger.info("Salle Tramontane mise à jour.")
                 else:
                      # If other rooms exist but not Tramontane, add it
                      salle_tramontane = Salle(nom='Salle Tramontane', capacite=15, lieu='Bâtiment A, RDC', description='Salle de formation polyvalente')
                      db.session.add(salle_tramontane)
                      db.session.commit()
                      app.logger.info("Salle 'Salle Tramontane' ajoutée (car manquante).")

                 app.logger.info("Salles déjà présentes (vérification Tramontane effectuée).")


            # --- Initialize Themes ---
            if Theme.query.count() == 0:
                app.logger.info("Initialisation des thèmes...")
                themes_data = [
                    {'nom':'Communiquer avec Teams', 'description':'Apprenez à utiliser Microsoft Teams pour communiquer efficacement.'},
                    {'nom':'Gérer les tâches (Planner)', 'description':'Maîtrisez la gestion des tâches d\'équipe avec Planner et To Do.'},
                    {'nom':'Gérer mes fichiers (OneDrive/SharePoint)', 'description':'Organisez et partagez vos fichiers avec OneDrive et SharePoint.'},
                    {'nom':'Collaborer avec Teams', 'description':'Découvrez comment collaborer sur des documents via Microsoft Teams.'}
                ]
                for data in themes_data:
                    db.session.add(Theme(**data))
                db.session.commit()
                app.logger.info(f"{len(themes_data)} thèmes ajoutés.")
            else:
                app.logger.info("Thèmes déjà présents.")
                # Ensure standardization runs even if themes exist
                update_theme_names()

            # --- Initialize Sessions ---
            if Session.query.count() == 0:
                app.logger.info("Initialisation des sessions...")
                try:
                    # Get theme IDs
                    theme_comm_id = Theme.query.filter_by(nom='Communiquer avec Teams').first().id
                    theme_tasks_id = Theme.query.filter_by(nom='Gérer les tâches (Planner)').first().id
                    theme_files_id = Theme.query.filter_by(nom='Gérer mes fichiers (OneDrive/SharePoint)').first().id
                    theme_collab_id = Theme.query.filter_by(nom='Collaborer avec Teams').first().id
                    # Get the single salle ID
                    salle_id = Salle.query.filter_by(nom='Salle Tramontane').first().id

                    sessions_to_add = []
                    session_dates_themes = [
                        ('2025-05-13', [(time_obj(9, 0), time_obj(10, 30), theme_comm_id),
                                       (time_obj(10, 45), time_obj(12, 15), theme_comm_id),
                                       (time_obj(14, 0), time_obj(15, 30), theme_tasks_id),
                                       (time_obj(15, 45), time_obj(17, 15), theme_tasks_id)]),
                        ('2025-06-03', [(time_obj(9, 0), time_obj(10, 30), theme_tasks_id),
                                       (time_obj(10, 45), time_obj(12, 15), theme_tasks_id),
                                       (time_obj(14, 0), time_obj(15, 30), theme_files_id),
                                       (time_obj(15, 45), time_obj(17, 15), theme_files_id)]),
                        ('2025-06-20', [(time_obj(9, 0), time_obj(10, 30), theme_files_id),
                                       (time_obj(10, 45), time_obj(12, 15), theme_files_id),
                                       (time_obj(14, 0), time_obj(15, 30), theme_collab_id),
                                       (time_obj(15, 45), time_obj(17, 15), theme_collab_id)]),
                        ('2025-07-01', [(time_obj(9, 0), time_obj(10, 30), theme_collab_id),
                                       (time_obj(10, 45), time_obj(12, 15), theme_collab_id),
                                       (time_obj(14, 0), time_obj(15, 30), theme_comm_id), # Corresponds to session 15 in logs
                                       (time_obj(15, 45), time_obj(17, 15), theme_comm_id)]) # Corresponds to session 16 in logs
                    ]

                    for date_str, timeslots in session_dates_themes:
                        date_obj = date.fromisoformat(date_str)
                        for start, end, theme_id in timeslots:
                            sessions_to_add.append(Session(
                                date=date_obj, heure_debut=start, heure_fin=end,
                                theme_id=theme_id, max_participants=15, salle_id=salle_id
                            ))

                    db.session.bulk_save_objects(sessions_to_add)
                    db.session.commit()
                    app.logger.info(f"{len(sessions_to_add)} sessions ajoutées.")

                except Exception as sess_init_err:
                    db.session.rollback()
                    app.logger.error(f"Erreur lors de l'initialisation des sessions: {sess_init_err}", exc_info=True)
            else:
                 # Ensure all sessions point to Salle Tramontane if they exist
                 salle_tramontane_id = Salle.query.filter_by(nom='Salle Tramontane').first().id
                 updated_count = Session.query.filter(Session.salle_id != salle_tramontane_id).update({'salle_id': salle_tramontane_id})
                 if updated_count > 0:
                     db.session.commit()
                     app.logger.info(f"{updated_count} sessions réassignées à Salle Tramontane.")
                 app.logger.info("Sessions déjà présentes (vérification salle effectuée).")


            # --- Initialize Users ---
            if User.query.count() == 0:
                app.logger.info("Initialisation des utilisateurs...")
                admin_user = User(username='admin', email='admin@anecoop-france.com', role='admin')
                admin_user.set_password('Anecoop2025') # Use a strong password, maybe from env vars
                db.session.add(admin_user)
                users_added_count = 1

                services = Service.query.all()
                for service in services:
                    # Create a simple username based on responsable name
                    # Handle potential duplicates and special characters robustly
                    base_username = "".join(filter(str.isalnum, service.responsable.split()[0])).lower()[:15]
                    username = base_username
                    counter = 1
                    while User.query.filter_by(username=username).first():
                        username = f"{base_username}{counter}"
                        counter += 1

                    responsable_user = User(
                        username=username, email=service.email_responsable,
                        role='responsable', service_id=service.id
                    )
                    responsable_user.set_password('Anecoop2025') # Default password, should be changed
                    db.session.add(responsable_user)
                    users_added_count += 1

                db.session.commit()
                app.logger.info(f"{users_added_count} utilisateurs ajoutés.")
            else:
                app.logger.info("Utilisateurs déjà présents.")

            # --- Initialize Participants (Qualité service) ---
            qualite_service_id = 'qualite'
            qualite_participants = [
                {'nom': 'PHILIBERT', 'prenom': 'Elodie', 'email': 'ephilibert@anecoop-france.com'},
                {'nom': 'SARRAZIN', 'prenom': 'Enora', 'email': 'esarrazin@anecoop-france.com'},
                {'nom': 'CASTAN', 'prenom': 'Sophie', 'email': 'scastan@anecoop-france.com'},
                {'nom': 'BERNAL', 'prenom': 'Paola', 'email': 'pbernal@anecoop-france.com'}
            ]
            participants_added = 0
            for p_data in qualite_participants:
                 if not Participant.query.filter(func.lower(Participant.email) == p_data['email'].lower()).first():
                     participant = Participant(
                         nom=p_data['nom'], prenom=p_data['prenom'],
                         email=p_data['email'], service_id=qualite_service_id
                     )
                     db.session.add(participant)
                     participants_added += 1
            if participants_added > 0:
                 db.session.commit()
                 cache.delete('participants_list_with_service')
                 cache.delete(f'service_participant_count_{qualite_service_id}')
                 cache.delete('all_services_with_participants')
                 app.logger.info(f"{participants_added} participants du service Qualité ajoutés.")
            else:
                 app.logger.info("Participants Qualité déjà présents.")


            # --- Initial Activity Log ---
            if Activite.query.count() == 0:
                app.logger.info("Ajout activités initiales...")
                admin_user = User.query.filter_by(role='admin').first()
                activites_data = [
                    {'type': 'systeme', 'description': 'Initialisation de l\'application', 'details': 'Base de données et données initiales créées'},
                    {'type': 'systeme', 'description': 'Création des comptes utilisateurs initiaux', 'details': 'Admin et responsables créés', 'utilisateur_id': admin_user.id if admin_user else None}
                ]
                for data in activites_data:
                    db.session.add(Activite(**data))
                db.session.commit()
                app.logger.info("Activités initiales ajoutées.")

            app.logger.info("Initialisation de la base de données terminée avec succès.")
            return True

        except SQLAlchemyError as e:
            db.session.rollback()
            app.logger.exception(f"ÉCHEC INITIALISATION DB (SQLAlchemyError): {e}")
            print(f"ERREUR INIT DB: {e}")
            return False
        except Exception as e:
            db.session.rollback()
            app.logger.exception(f"ERREUR INATTENDUE INITIALISATION: {e}")
            print(f"ERREUR INIT: {e}")
            return False

# === Main Execution ===
if __name__ == '__main__':
    # Configure logging based on debug status
    configure_logging(app)

    is_production = os.environ.get('RENDER') or os.environ.get('FLASK_ENV') == 'production'
    port = int(os.environ.get('PORT', 5000))
    # Set debug mode based on environment, default to True if not production
    debug_mode = not is_production
    app.debug = debug_mode # Ensure Flask's debug mode matches

    with app.app_context():
        try:
            connection_ok = check_db_connection()
            if connection_ok:
                print("Connexion DB OK.")
                # Attempt initialization only if DB seems empty or specific tables are missing
                if not db.engine.dialect.has_table(db.engine.connect(), 'service'):
                    print("Tables manquantes, lancement init_db()...")
                    init_success = init_db()
                    if not init_success:
                        print("⚠️ Échec de l'initialisation de la DB.")
                else:
                    print("DB déjà initialisée (table 'service' existe).")
                    # Run standardization checks even if DB exists
                    try:
                        update_theme_names()
                    except Exception as update_err:
                        print(f"Note: Erreur lors de la standardisation des thèmes: {update_err}")
            else:
                print("⚠️ ERREUR CONNEXION DB au démarrage")
                print("Impossible de vérifier/initialiser la DB. L'application pourrait ne pas fonctionner correctement.")

        except OperationalError as oe:
            print(f"⚠️ ERREUR CONNEXION DB au démarrage: {oe}")
            print("Impossible de vérifier/initialiser la DB.")
        except Exception as e:
            print(f"⚠️ Erreur lors de la vérification/initialisation de la DB: {e}")
            try:
                db.session.rollback()
            except Exception as rb_e:
                print(f"Erreur supplémentaire pendant le rollback: {rb_e}")

    # Start the server
    try:
        host = '0.0.0.0' # Listen on all interfaces
        print(f"Démarrage serveur en MODE {'PRODUCTION' if is_production else 'DÉVELOPPEMENT'} avec {ASYNC_MODE} sur http://{host}:{port} (Debug: {debug_mode})")
        # Use SocketIO's run for development with reloader, Werkzeug for production
        if debug_mode:
             # allow_unsafe_werkzeug=True might be needed for some setups with SocketIO + Flask reloader
             socketio.run(app, host=host, port=port, use_reloader=True, debug=debug_mode, log_output=False, allow_unsafe_werkzeug=True)
        else:
             # For production, use a proper WSGI server like Gunicorn or Waitress
             # Example using Waitress (install with pip install waitress)
             # from waitress import serve
             # serve(app, host=host, port=port)
             # Or using Gunicorn (install with pip install gunicorn) - typically run from command line:
             # gunicorn -w 4 -b 0.0.0.0:5000 app:app
             # For simplicity here, just run Flask's built-in server without debug/reloader
             print("NOTE: Using Flask's built-in server for production is not recommended. Use Gunicorn or Waitress.")
             socketio.run(app, host=host, port=port, debug=False, use_reloader=False)

    except Exception as e:
        print(f"⚠️ ERREUR CRITIQUE au démarrage du serveur: {e}")
        import traceback
        traceback.print_exc()

# --- END OF app.py (Corrected v9 - Complete Routes) ---
