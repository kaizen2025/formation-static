# --- START OF COMPLETE app.py (Optimized Version) ---
# ***** 1. EVENTLET PATCHING (MUST BE FIRST) *****
try:
    import eventlet
    eventlet.monkey_patch()
    ASYNC_MODE = 'eventlet'
    print("Eventlet monkey patching appliqué.")
except ImportError:
    ASYNC_MODE = 'threading' # Fallback si eventlet n'est pas installé
    print("Eventlet non trouvé, utilisation du mode 'threading'.")
# ***** END EVENTLET PATCHING *****

import os
import psycopg2
import functools
import random
import time
from flask import (
    Flask, render_template, request, redirect, url_for,
    flash, jsonify, make_response
)
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from datetime import datetime, timedelta, UTC, date, time
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import (
    LoginManager, UserMixin, login_user, login_required,
    logout_user, current_user
)
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_caching import Cache
import json
from sqlalchemy.exc import IntegrityError, SQLAlchemyError, OperationalError, TimeoutError
from sqlalchemy.orm import joinedload, subqueryload
from sqlalchemy import func, text
import logging
from logging.handlers import RotatingFileHandler
from werkzeug.exceptions import ServiceUnavailable

from ics import Calendar, Event

# --- Configuration du cache ---
cache_config = {
    "CACHE_TYPE": "SimpleCache",  # Cache en mémoire, pas besoin d'installer Redis
    "CACHE_DEFAULT_TIMEOUT": 300   # Durée de vie des données en cache (5 minutes)
}

app = Flask(__name__)

# --- Configuration générale ---
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'a-very-secure-default-secret-key-for-dev-only')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    "DATABASE_URL",
    "postgresql://xvcyuaga:rfodwjclemtvhwvqsrpp@alpha.europe.mkdb.sh:5432/usdtdsgq"
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ECHO'] = False
app.config.from_mapping(cache_config)

# --- Optimized Database Connection Pool ---
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_size': 2,           # Légèrement augmenté mais reste petit
    'max_overflow': 2,        # Connexions supplémentaires en cas de pic
    'pool_timeout': 20,       # Temps d'attente plus long pour une connexion
    'pool_recycle': 60,       # Gardez les connexions plus longtemps
    'pool_pre_ping': True     # Test des connexions avant utilisation
}

# --- Configure Logging ---
# Create logs directory if it doesn't exist
logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
if not os.path.exists(logs_dir):
    os.makedirs(logs_dir)

# Configure application logging
def configure_logging(app):
    """Set up enhanced logging for the application"""
    if not app.debug:
        # File handler for general application logs
        app_log_file = os.path.join(logs_dir, 'app.log')
        file_handler = RotatingFileHandler(app_log_file, maxBytes=1024*1024, backupCount=5)
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
        ))
        file_handler.setLevel(logging.INFO)
        app.logger.addHandler(file_handler)
        
        # Set overall logging level for the app logger
        app.logger.setLevel(logging.INFO)
        
        # Create a separate handler for database errors
        db_log_file = os.path.join(logs_dir, 'db.log')
        db_handler = RotatingFileHandler(db_log_file, maxBytes=1024*1024, backupCount=5)
        db_handler.setFormatter(logging.Formatter(
            '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
        ))
        
        # Create a database logger
        db_logger = logging.getLogger('sqlalchemy')
        db_logger.setLevel(logging.WARNING)  # WARNING to avoid too much noise
        db_logger.addHandler(db_handler)
        
        # Create a socketio logger
        socket_log_file = os.path.join(logs_dir, 'socketio.log')
        socket_handler = RotatingFileHandler(socket_log_file, maxBytes=1024*1024, backupCount=3)
        socket_handler.setFormatter(logging.Formatter(
            '%(asctime)s %(levelname)s: %(message)s'
        ))
        
        socket_logger = logging.getLogger('socketio')
        socket_logger.setLevel(logging.WARNING)  # WARNING level to reduce noise
        socket_logger.addHandler(socket_handler)
        
        app.logger.info('Application logging initialized')
    else:
        # Setup minimal logging in debug mode
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.DEBUG)
        console_handler.setFormatter(logging.Formatter(
            '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
        ))
        app.logger.addHandler(console_handler)
        app.logger.setLevel(logging.DEBUG)

# Initialize components
db = SQLAlchemy(app)
migrate = Migrate(app, db)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message = "Veuillez vous connecter pour accéder à cette page."
login_manager.login_message_category = "info"
cache = Cache(app)

socketio = SocketIO(
    app, 
    cors_allowed_origins="*", 
    async_mode=ASYNC_MODE, 
    engineio_logger=False, 
    logger=False,
    ping_timeout=10,     # Shorter ping timeout
    ping_interval=25     # Adjusted ping interval
)
print(f"SocketIO initialisé avec async_mode='{ASYNC_MODE}'")

# Setup logging
configure_logging(app)

# ---- Decorateur pour retenter les opérations de base de données en cas d'échec ----
def db_operation_with_retry(max_retries=3, retry_delay=0.5):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            while retries < max_retries:
                try:
                    return func(*args, **kwargs)
                except (OperationalError, TimeoutError) as e:
                    retries += 1
                    app.logger.warning(f"DB operation failed (attempt {retries}/{max_retries}): {e}")
                    db.session.rollback()
                    if retries >= max_retries:
                        app.logger.error(f"Max retries reached for DB operation: {e}")
                        raise
                    # Attente avec jitter pour éviter la congestion
                    jitter = random.uniform(0, 0.5)
                    time.sleep(retry_delay * retries + jitter)
            raise ServiceUnavailable("Database service temporarily unavailable")
        return wrapper
    return decorator

# === Context Processors ===
@app.context_processor
def inject_now():
    return dict(now=datetime.now(UTC))

# === Modèles DB ===
class Service(db.Model):
    __tablename__ = 'service'
    id = db.Column(db.String(20), primary_key=True)
    nom = db.Column(db.String(100), nullable=False, unique=True)
    couleur = db.Column(db.String(7), nullable=False, default='#6c757d')
    responsable = db.Column(db.String(100), nullable=False)
    email_responsable = db.Column(db.String(100), nullable=False)
    participants = db.relationship('Participant', backref='service', lazy='select')
    users = db.relationship('User', backref='service', lazy='select')
    def __repr__(self): return f'<Service {self.nom}>'

class Salle(db.Model):
    __tablename__ = 'salle'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False, unique=True)
    capacite = db.Column(db.Integer, default=15, nullable=False)
    lieu = db.Column(db.String(200), nullable=True)
    description = db.Column(db.Text, nullable=True)
    sessions = db.relationship('Session', backref='salle', lazy='dynamic')
    def __repr__(self): return f'<Salle {self.nom}>'

class Theme(db.Model):
    __tablename__ = 'theme'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False, unique=True)
    description = db.Column(db.Text, nullable=True)
    sessions = db.relationship('Session', backref='theme', lazy='select')
    def __repr__(self): return f'<Theme {self.nom}>'

class Session(db.Model):
    __tablename__ = 'session'
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False)
    heure_debut = db.Column(db.Time, nullable=False)
    heure_fin = db.Column(db.Time, nullable=False)
    theme_id = db.Column(db.Integer, db.ForeignKey('theme.id'), nullable=False)
    max_participants = db.Column(db.Integer, default=15, nullable=False)
    salle_id = db.Column(db.Integer, db.ForeignKey('salle.id'), nullable=True)
    inscriptions = db.relationship('Inscription', backref='session', lazy='dynamic', cascade="all, delete-orphan")
    liste_attente = db.relationship('ListeAttente', backref='session', lazy='dynamic', cascade="all, delete-orphan")
    # Utiliser get_places_restantes pour la logique métier
    def get_places_restantes(self, confirmed_count=None):
        try:
            if confirmed_count is None: confirmed_count = self.inscriptions.filter_by(statut='confirmé').count()
            return max(0, self.max_participants - confirmed_count)
        except (OperationalError, TimeoutError) as oe: 
            db.session.rollback()
            app.logger.error(f"DB Pool/Conn Error get_places_restantes S:{self.id}: {oe}")
            return 0
        except Exception as e: 
            app.logger.error(f"Err get_places_restantes S:{self.id}: {e}")
            return 0
    @property
    def formatage_date(self):
        try: 
            jour_semaine = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
            mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
            return f"{jour_semaine[self.date.weekday()]} {self.date.day} {mois[self.date.month-1]} {self.date.year}"
        except Exception: 
            return self.date.strftime('%d/%m/%Y')
    @property
    def formatage_horaire(self):
        try: 
            debut = f"{self.heure_debut.hour:02d}h{self.heure_debut.minute:02d}"
            fin = f"{self.heure_fin.hour:02d}h{self.heure_fin.minute:02d}"
            return f"{debut}–{fin}"
        except Exception: 
            return f"{self.heure_debut.strftime('%H:%M')}–{self.heure_fin.strftime('%H:%M')}"
    @property
    def formatage_ics(self): 
        date_debut = datetime.combine(self.date, self.heure_debut)
        date_fin = datetime.combine(self.date, self.heure_fin)
        return date_debut, date_fin
    def __repr__(self): 
        return f'<Session {self.id} - {self.theme.nom if self.theme else "N/A"} le {self.date}>'

class Participant(db.Model):
    __tablename__ = 'participant'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    prenom = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), nullable=False, unique=True, index=True)
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=False)
    inscriptions = db.relationship('Inscription', backref='participant', lazy='dynamic', cascade="all, delete-orphan")
    liste_attente = db.relationship('ListeAttente', backref='participant', lazy='dynamic', cascade="all, delete-orphan")
    def __repr__(self): return f'<Participant {self.prenom} {self.nom}>'
    
class Inscription(db.Model):
    __tablename__ = 'inscription'
    id = db.Column(db.Integer, primary_key=True)
    participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False)
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False)
    date_inscription = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False)
    statut = db.Column(db.String(20), default='en attente', nullable=False)
    validation_responsable = db.Column(db.Boolean, default=False, nullable=False)
    presence = db.Column(db.Boolean, default=None, nullable=True)
    notification_envoyee = db.Column(db.Boolean, default=False, nullable=False)
    __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_inscription'),)
    def __repr__(self): return f'<Inscription {self.id} - P:{self.participant_id} S:{self.session_id} Statut:{self.statut}>'
    
class ListeAttente(db.Model):
    __tablename__ = 'liste_attente'
    id = db.Column(db.Integer, primary_key=True)
    participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False)
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False)
    date_inscription = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False)
    position = db.Column(db.Integer, nullable=False)
    notification_envoyee = db.Column(db.Boolean, default=False, nullable=False)
    __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_liste_attente'),)
    def __repr__(self): return f'<ListeAttente {self.id} - P:{self.participant_id} S:{self.session_id} Pos:{self.position}>'
    
class Activite(db.Model):
    __tablename__ = 'activite'
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(50), nullable=False, index=True)
    description = db.Column(db.Text, nullable=False)
    details = db.Column(db.Text, nullable=True)
    date = db.Column(db.DateTime, default=lambda: datetime.now(UTC), nullable=False, index=True)
    utilisateur_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    @property
    def date_relative(self):
        now = datetime.now(UTC)
        aware_date = self.date.replace(tzinfo=UTC) if self.date.tzinfo is None else self.date
        if aware_date > now:
            try: return f"le {aware_date.strftime('%d/%m/%Y à %H:%M')}"
            except: return "dans le futur"
        diff = now - aware_date
        seconds = diff.total_seconds()
        if seconds < 5: return "à l'instant"
        elif seconds < 60: return f"il y a {int(seconds)} seconde{'s' if int(seconds) >= 2 else ''}"
        elif seconds < 3600: minutes = int(seconds // 60); return f"il y a {minutes} minute{'s' if minutes >= 2 else ''}"
        elif seconds < 86400: hours = int(seconds // 3600); return f"il y a {hours} heure{'s' if hours >= 2 else ''}"
        else: days = int(seconds // 86400); return f"il y a {days} jour{'s' if days >= 2 else ''}"
    def __repr__(self): return f'<Activite {self.id} - Type:{self.type} Date:{self.date}>'
    
class User(UserMixin, db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    role = db.Column(db.String(20), default='user', nullable=False)
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=True)
    activites = db.relationship('Activite', backref='utilisateur', lazy='dynamic', foreign_keys='Activite.utilisateur_id')
    def set_password(self, password): self.password_hash = generate_password_hash(password)
    def check_password(self, password): return check_password_hash(self.password_hash, password)
    def __repr__(self): return f'<User {self.username} ({self.role})>'

# === Flask-Login Configuration ===
@login_manager.user_loader
def load_user(user_id):
    try: return db.session.get(User, int(user_id))
    except Exception as e: app.logger.error(f"Error loading user {user_id}: {e}"); return None

# === Database Session Teardown with improved error handling ===
@app.teardown_appcontext
def shutdown_session(exception=None):
    if exception:
        app.logger.debug(f"Rolling back session due to exception: {exception}")
        try:
            db.session.rollback()
        except Exception as rb_e:
            app.logger.error(f"Error during rollback: {rb_e}")
    
    try:
        db.session.remove()
    except Exception as e:
        app.logger.error(f"Error removing session: {e}")

# === Helper Functions ===
@db_operation_with_retry(max_retries=3)
def check_db_connection():
    """Verify database connection health"""
    try:
        # Simple query to test connection
        db.session.execute(text("SELECT 1"))
        db.session.commit()
        return True
    except Exception as e:
        app.logger.error(f"DB Connection health check failed: {e}")
        db.session.rollback()
        return False

def generate_ics(session, participant, salle=None):
    try:
        cal = Calendar(); event = Event()
        date_debut, date_fin = session.formatage_ics
        event.name = f"Formation: {session.theme.nom}"
        event.begin = date_debut
        event.end = date_fin
        description_lines = [f"Formation Microsoft 365\n\nThème: {session.theme.nom}", f"Date: {session.formatage_date}", f"Horaire: {session.formatage_horaire}"]
        if salle: description_lines.append(f"\nLieu: {salle.nom}"); event.location = salle.nom;
        if salle and salle.lieu: description_lines.append(f"Adresse: {salle.lieu}")
        description_lines.append(f"\nParticipant: {participant.prenom} {participant.nom}")
        event.description = "\n".join(description_lines)
        event.alarms = [Event.alarm(trigger=timedelta(hours=-1))]
        cal.events.add(event)
        return cal.serialize()
    except Exception as e: 
        app.logger.error(f"Error generating ICS S:{session.id}, P:{participant.id}: {e}", exc_info=True)
        return None

@db_operation_with_retry(max_retries=3)
def check_waitlist(session_id):
    try:
        session = db.session.get(Session, session_id)
        if not session: return False
        # Utiliser la méthode sûre pour vérifier les places
        if session.get_places_restantes() <= 0: return False
        next_in_line = ListeAttente.query.filter_by(session_id=session_id, notification_envoyee=False).order_by(ListeAttente.position).first()
        if next_in_line:
            next_in_line.notification_envoyee = True
            db.session.commit()
            socketio.emit('notification', { 
                'event': 'place_disponible', 
                'message': f"Place libérée pour '{session.theme.nom}' ({session.formatage_date})!", 
                'session_id': session_id, 
                'participant_id': next_in_line.participant_id 
            }, room=f'user_{next_in_line.participant_id}')
            add_activity('notification', f'Notification place dispo', f'Session: {session.theme.nom}, Part: {next_in_line.participant.prenom} {next_in_line.participant.nom}')
            app.logger.info(f"Notified P:{next_in_line.participant_id} for S:{session_id}")
            return True
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error check_waitlist S:{session_id}: {oe}")
    except SQLAlchemyError as e: 
        db.session.rollback()
        app.logger.error(f"DB error check_waitlist S:{session_id}: {e}")
    except Exception as e: 
        app.logger.error(f"Error check_waitlist S:{session_id}: {e}")
    return False

@db_operation_with_retry(max_retries=3)
def add_activity(type, description, details=None, user=None):
    try:
        if user is None and current_user.is_authenticated: user = current_user
        activite = Activite(
            type=type, 
            description=description, 
            details=details, 
            utilisateur_id=user.id if user and user.is_authenticated else None
        )
        db.session.add(activite)
        db.session.commit()
        socketio.emit('nouvelle_activite', { 
            'id': activite.id, 
            'type': activite.type, 
            'description': activite.description, 
            'details': activite.details, 
            'date_relative': activite.date_relative, 
            'user': activite.utilisateur.username if activite.utilisateur else None 
        }, room='general')
        app.logger.debug(f"Activity: {type} - {description}")
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error adding activity '{type}': {oe}")
    except SQLAlchemyError as e: 
        db.session.rollback()
        app.logger.error(f"DB error adding activity '{type}': {e}")
    except Exception as e: 
        app.logger.error(f"Error adding activity '{type}': {e}")

@db_operation_with_retry(max_retries=3)
def update_theme_names():
    with app.app_context():
        try:
            changes_made = False
            onedrive_theme = Theme.query.filter(Theme.nom.like('%OneDrive%')).first()
            if onedrive_theme and onedrive_theme.nom != 'Gérer mes fichiers (OneDrive/SharePoint)': 
                onedrive_theme.nom = 'Gérer mes fichiers (OneDrive/SharePoint)'
                onedrive_theme.description = 'Apprenez à organiser et partager vos fichiers avec OneDrive et SharePoint.'
                changes_made = True
            collaborer_theme = Theme.query.filter(Theme.nom.like('%Collaborer%')).first()
            if collaborer_theme and collaborer_theme.nom != 'Collaborer avec Teams': 
                collaborer_theme.nom = 'Collaborer avec Teams'
                collaborer_theme.description = 'Découvrez comment collaborer sur des documents avec Microsoft Teams.'
                changes_made = True
            if changes_made: 
                db.session.commit()
                print("Noms thèmes MàJ.")
            else: 
                print("Noms thèmes OK.")
        except (OperationalError, TimeoutError) as oe: 
            db.session.rollback()
            app.logger.error(f"DB Pool/Conn Error updating theme names: {oe}")
            print("Erreur connexion DB MàJ noms thèmes.")
        except SQLAlchemyError as e: 
            db.session.rollback()
            app.logger.error(f"DB error updating theme names: {e}")
            print("Erreur MàJ noms thèmes.")

# ---- FONCTIONS AVEC MISE EN CACHE pour réduire les requêtes ----
@cache.cached(timeout=60, key_prefix='all_themes')
@db_operation_with_retry(max_retries=3)
def get_all_themes():
    """Récupérer tous les thèmes avec mise en cache"""
    return Theme.query.order_by(Theme.nom).all()

@cache.cached(timeout=60, key_prefix='all_services')
@db_operation_with_retry(max_retries=3)
def get_all_services():
    """Récupérer tous les services avec mise en cache"""
    return Service.query.order_by(Service.nom).all()

@cache.cached(timeout=30, key_prefix='all_salles')
@db_operation_with_retry(max_retries=3)
def get_all_salles():
    """Récupérer toutes les salles avec mise en cache"""
    return Salle.query.order_by(Salle.nom).all()

@cache.cached(timeout=30, key_prefix='participants_list')
@db_operation_with_retry(max_retries=3)
def get_all_participants():
    """Récupérer tous les participants avec mise en cache"""
    return Participant.query.options(joinedload(Participant.service)).order_by(Participant.nom, Participant.prenom).all()

# === WebSocket Event Handlers ===
@socketio.on('connect')
def handle_connect():
    # ***** SIMPLIFIED Connect Handler *****
    # Avoid accessing current_user or DB here if it causes issues
    app.logger.info(f'Client connected: {request.sid}')
    try:
        emit('status', {'msg': 'Connected'})
        # Try joining rooms after emitting status
        socketio.emit('join', { 'room': 'general' }, room=request.sid)
        # We cannot reliably access current_user here if login hasn't happened
        # or if context is not available due to async mode issues.
        # User-specific room joining might need to happen after login confirmation.
    except Exception as e:
        app.logger.error(f"ERROR during simplified SocketIO connect handler for {request.sid}: {e}", exc_info=True)

@socketio.on('disconnect')
def handle_disconnect():
    # Cannot reliably access current_user here either
    app.logger.info(f'Client disconnected: {request.sid}')

@socketio.on('join')
def handle_join(data):
    room = data.get('room')
    sid = request.sid # Get sid here as request might not be available in except block
    if room:
        try:
            join_room(room)
            app.logger.info(f'Client {sid} joined room: {room}')
            emit('status', {'msg': f'Joined room {room}'}, room=sid)
        except Exception as e:
             app.logger.error(f"ERROR during SocketIO join handler for {sid}, room {room}: {e}", exc_info=True)
    else:
        app.logger.warning(f'Client {sid} tried to join without room.')

@socketio.on('heartbeat')
def handle_heartbeat(data):
    sid = request.sid
    try:
        emit('heartbeat_response', {'timestamp': datetime.now(UTC).timestamp()})
    except Exception as e:
        app.logger.error(f"ERROR during SocketIO heartbeat handler for {sid}: {e}", exc_info=True)

# === Flask Routes with Enhanced Error Handling ===
# --- Core Navigation & Auth ---
@app.route('/')
def index(): 
    return redirect(url_for('dashboard'))

@app.route('/dashboard')
@db_operation_with_retry(max_retries=3)
def dashboard():
    try:
        # Utilisation des fonctions avec cache
        themes = get_all_themes()
        services = get_all_services()
        salles = get_all_salles()
        participants = get_all_participants()
        
        # Eager load relationships needed for the main dashboard display
        sessions_query = Session.query.options(
            joinedload(Session.theme),
            joinedload(Session.salle)
        ).order_by(Session.date, Session.heure_debut)

        sessions = sessions_query.all()
        
        # Calculate counts efficiently with error handling
        try:
            total_inscriptions = db.session.query(func.count(Inscription.id)).filter(Inscription.statut == 'confirmé').scalar() or 0
            total_en_attente = db.session.query(func.count(ListeAttente.id)).scalar() or 0
        except Exception as count_error:
            app.logger.error(f"Error calculating counts: {count_error}")
            total_inscriptions = 0
            total_en_attente = 0

        # Calculate completed sessions safely and prepare data for template
        total_sessions_completes = 0
        successful_sessions_check = 0
        sessions_data_for_template = []
        
        for s in sessions:
            try:
                # Cache des requêtes complexes par session
                cache_key = f'session_counts_{s.id}'
                session_counts = cache.get(cache_key)
                
                if session_counts is None:
                    inscrits_count = s.inscriptions.filter_by(statut='confirmé').count()
                    attente_count = s.liste_attente.count()
                    pending_count = s.inscriptions.filter_by(statut='en attente').count()
                    places_rest = max(0, s.max_participants - inscrits_count)
                    
                    session_counts = {
                        'inscrits_confirmes_count': inscrits_count,
                        'liste_attente_count': attente_count,
                        'pending_count': pending_count,
                        'places_restantes': places_rest
                    }
                    cache.set(cache_key, session_counts, timeout=30)
                
                session_dict = {
                    'obj': s,
                    'places_restantes': session_counts['places_restantes'],
                    'inscrits_confirmes_count': session_counts['inscrits_confirmes_count'],
                    'liste_attente_count': session_counts['liste_attente_count'],
                    'pending_count': session_counts['pending_count']
                }
                
                sessions_data_for_template.append(session_dict)
                
                if session_counts['places_restantes'] == 0:
                    total_sessions_completes += 1
                successful_sessions_check += 1
            except Exception as sess_error:
                app.logger.error(f"Error processing session {s.id}: {sess_error}")
                # Add minimal data with defaults to avoid template errors
                sessions_data_for_template.append({
                    'obj': s,
                    'places_restantes': 0,
                    'inscrits_confirmes_count': 0,
                    'liste_attente_count': 0,
                    'pending_count': 0
                })

        if successful_sessions_check < len(sessions):
             flash("Statistiques sessions partielles (problème accès données).", "warning")

        return render_template(
            'dashboard.html', 
            themes=themes, 
            sessions_data=sessions_data_for_template,
            services=services, 
            participants=participants, 
            salles=salles,
            total_inscriptions=total_inscriptions, 
            total_en_attente=total_en_attente,
            total_sessions_completes=total_sessions_completes
        )
        
    except (OperationalError, TimeoutError) as oe:
        db.session.rollback()
        app.logger.error(f"DB Pool/Connection Error on dashboard: {oe}")
        flash("Erreur connexion base de données. Veuillez réessayer.", "danger")
        return render_template('error.html', error_message="Erreur connexion base de données."), 503
        
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading dashboard: {e}")
        flash("Erreur chargement tableau de bord.", "danger")
        return render_template('error.html', error_message="Erreur base de données."), 500
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error in dashboard route: {e}", exc_info=True)
        flash("Erreur interne.", "danger")
        return render_template('error.html', error_message="Erreur interne du serveur."), 500

@app.route('/login', methods=['GET', 'POST'])
@db_operation_with_retry(max_retries=3)
def login():
    if current_user.is_authenticated: 
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        remember = True if request.form.get('remember') else False
        try:
            user = User.query.filter_by(username=username).first()
            if user and user.check_password(password):
                login_user(user, remember=remember)
                add_activity('connexion', f'Connexion de {user.username}', user=user)
                next_page = request.args.get('next')
                if next_page and not next_page.startswith('/'):
                    next_page = url_for('dashboard')
                return redirect(next_page or url_for('dashboard'))
            else: 
                flash('Nom d\'utilisateur ou mot de passe incorrect.', 'danger')
        except (OperationalError, TimeoutError) as oe: 
            db.session.rollback()
            app.logger.error(f"DB Pool/Conn Error on login: {oe}")
            flash("Erreur connexion DB.", "danger")
        except Exception as e: 
            db.session.rollback()
            app.logger.error(f"Error during login: {e}")
            flash("Erreur interne.", "danger")
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout(): 
    add_activity('deconnexion', f'Déconnexion de {current_user.username}', user=current_user)
    logout_user()
    flash('Déconnecté avec succès.', 'success')
    return redirect(url_for('login'))

# --- Public/User Views ---
@app.route('/services')
@db_operation_with_retry(max_retries=3)
def services():
    try:
        services = get_all_services()
        service_data = []
        for s in services:
            try: 
                cache_key = f'service_participant_count_{s.id}'
                p_count = cache.get(cache_key)
                
                if p_count is None:
                    p_count = len(s.participants)
                    cache.set(cache_key, p_count, timeout=60)
            except (OperationalError, TimeoutError) as oe_inner: 
                db.session.rollback()
                app.logger.error(f"DB Pool/Conn Error counting participants for service {s.id}: {oe_inner}")
                p_count = -1
            except Exception as e_inner: 
                db.session.rollback()
                app.logger.error(f"Error counting participants for service {s.id}: {e_inner}")
                p_count = -1
            service_data.append({'obj': s, 'participant_count': p_count})
        participants = get_all_participants()
        return render_template('services.html', services_data=service_data, participants=participants)
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error loading services: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        return render_template('error.html', error_message="Erreur connexion base de données."), 503
    except SQLAlchemyError as e: 
        app.logger.error(f"DB error loading services: {e}")
        flash("Erreur chargement services.", "danger")
        return redirect(url_for('dashboard'))

@app.route('/sessions')
@db_operation_with_retry(max_retries=3)
def sessions():
    try:
        # Basic query with eager loading
        query = Session.query.options(
            joinedload(Session.theme), 
            joinedload(Session.salle)
        ).order_by(Session.date, Session.heure_debut)
        
        # Apply filters
        theme_id = request.args.get('theme')
        date_str = request.args.get('date')
        places = request.args.get('places')
        
        if theme_id: 
            query = query.filter(Session.theme_id == theme_id)
            
        if date_str:
            try: 
                date_obj = date.fromisoformat(date_str)
                query = query.filter(Session.date >= date_obj)
            except ValueError: 
                flash('Format date invalide (AAAA-MM-JJ).', 'warning')
                
        # Execute query with error handling
        try:
            all_sessions_filtered_basic = query.all()
        except Exception as query_error:
            app.logger.error(f"Error executing sessions query: {query_error}")
            all_sessions_filtered_basic = []
            flash("Erreur lors de la recherche des sessions.", "warning")
        
        # Process results safely
        sessions_final_data = []
        for s in all_sessions_filtered_basic:
            try:
                cache_key = f'session_counts_{s.id}'
                session_counts = cache.get(cache_key)
                
                if session_counts is None:
                    inscrits_count = s.inscriptions.filter_by(statut='confirmé').count()
                    attente_count = s.liste_attente.count()
                    pending_count = s.inscriptions.filter_by(statut='en attente').count()
                    places_rest = max(0, s.max_participants - inscrits_count)
                    
                    session_counts = {
                        'inscrits_confirmes_count': inscrits_count,
                        'liste_attente_count': attente_count,
                        'pending_count': pending_count,
                        'places_restantes': places_rest
                    }
                    cache.set(cache_key, session_counts, timeout=30)
                
                session_dict = {
                    'obj': s, 
                    'places_restantes': session_counts['places_restantes'], 
                    'inscrits_confirmes_count': session_counts['inscrits_confirmes_count'], 
                    'liste_attente_count': session_counts['liste_attente_count'],
                    'pending_count': session_counts['pending_count']
                }
                
                # Apply additional filter logic
                if places == 'available' and session_counts['places_restantes'] <= 0: 
                    continue
                if places == 'full' and session_counts['places_restantes'] > 0: 
                    continue
                    
                sessions_final_data.append(session_dict)
                
            except Exception as process_error:
                app.logger.error(f"Error processing session {s.id}: {process_error}")
                # Skip problematic session or add with defaults
                continue
                
        # Fetch additional data needed for template
        try:
            themes = get_all_themes()
            participants = get_all_participants()
            services = get_all_services()
            salles = []
            if current_user.is_authenticated and current_user.role == 'admin': 
                salles = get_all_salles()
        except Exception as data_error:
            app.logger.error(f"Error fetching template data: {data_error}")
            themes = []
            participants = []
            services = []
            salles = []
            flash("Erreur lors du chargement des données additionnelles.", "warning")
            
        # Render template
        return render_template(
            'sessions.html',
            sessions_data=sessions_final_data,
            themes=themes,
            participants=participants,
            services=services,
            salles=salles
        )
        
    except (OperationalError, TimeoutError) as oe:
        db.session.rollback()
        app.logger.error(f"DB Pool/Connection Error on sessions: {oe}")
        flash("Erreur connexion base de données. Veuillez réessayer.", "danger")
        return render_template('error.html', error_message="Erreur connexion base de données."), 503
        
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.error(f"DB error loading sessions: {e}")
        flash("Erreur chargement sessions.", "danger")
        return redirect(url_for('dashboard'))
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Unexpected error in sessions route: {e}", exc_info=True)
        flash("Erreur interne.", "danger")
        return redirect(url_for('dashboard'))

# --- Actions (Inscriptions, Waitlist, Validation) ---
@app.route('/inscription', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def inscription():
    redirect_url = request.referrer or url_for('dashboard')
    try:
        participant_id = request.form.get('participant_id', type=int)
        session_id = request.form.get('session_id', type=int)
        
        if not participant_id or not session_id: 
            flash('Données manquantes.', 'danger')
            return redirect(redirect_url)
            
        participant = db.session.get(Participant, participant_id)
        session_obj = db.session.get(Session, session_id)
        
        if not participant or not session_obj: 
            flash('Participant/Session introuvable.', 'danger')
            return redirect(redirect_url)
            
        # Check if already registered
        if (Inscription.query.filter_by(participant_id=participant_id, session_id=session_id).first() or 
            ListeAttente.query.filter_by(participant_id=participant_id, session_id=session_id).first()):
            flash(f'{participant.prenom} {participant.nom} déjà inscrit ou en attente.', 'warning')
            return redirect(redirect_url)
            
        # Check available spots
        if session_obj.get_places_restantes() <= 0: 
            flash('Session complète.', 'warning')
            return redirect(url_for('liste_attente', participant_id=participant_id, session_id=session_id))
            
        # Create inscription
        inscription = Inscription(participant_id=participant_id, session_id=session_id, statut='en attente')
        db.session.add(inscription)
        db.session.commit()
        
        # Invalidate cache for this session
        cache.delete(f'session_counts_{session_id}')
        
        # Record activity
        add_activity('inscription', 
                     f'Demande inscription: {participant.prenom} {participant.nom}', 
                     f'Session: {session_obj.theme.nom} ({session_obj.formatage_date})', 
                     user=current_user)
                     
        # Notify via WebSocket
        socketio.emit('inscription_nouvelle', {
            'session_id': session_id, 
            'participant_id': participant_id, 
            'statut': 'en attente'
        }, room='general')
        
        flash('Demande d\'inscription enregistrée (attente validation).', 'info')
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error on inscription: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except IntegrityError: 
        db.session.rollback()
        flash('Erreur: Inscription déjà existante.', 'danger')
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB inscription.', 'danger')
        app.logger.error(f"SQLAlchemyError inscription: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error inscription: {e}")
        
    return redirect(redirect_url)

@app.route('/liste_attente', methods=['GET', 'POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def liste_attente():
    participant_id = request.args.get('participant_id', type=int) or request.form.get('participant_id', type=int)
    session_id = request.args.get('session_id', type=int) or request.form.get('session_id', type=int)
    redirect_url = request.referrer or url_for('dashboard')
    
    if not participant_id or not session_id: 
        flash('Infos manquantes.', 'danger')
        return redirect(redirect_url)
        
    try:
        participant = db.session.get(Participant, participant_id)
        session_obj = db.session.get(Session, session_id)
        
        if not participant or not session_obj: 
            flash('Participant/Session introuvable.', 'danger')
            return redirect(redirect_url)
            
        # Check if already registered
        if (ListeAttente.query.filter_by(participant_id=participant_id, session_id=session_id).first() or 
            Inscription.query.filter_by(participant_id=participant_id, session_id=session_id).first()):
            flash(f"{participant.prenom} {participant.nom} déjà inscrit/en attente.", 'warning')
            return redirect(redirect_url)
            
        # Check if spots available
        if session_obj.get_places_restantes() > 0: 
            flash(f"Il reste {session_obj.get_places_restantes()} place(s). Inscrivez-vous directement.", 'info')
            return redirect(url_for('sessions'))
            
        # Process POST request
        if request.method == 'POST':
            position = ListeAttente.query.filter_by(session_id=session_id).count() + 1
            attente = ListeAttente(participant_id=participant_id, session_id=session_id, position=position)
            db.session.add(attente)
            db.session.commit()
            
            # Invalidate cache for this session
            cache.delete(f'session_counts_{session_id}')
            
            # Record activity
            add_activity('liste_attente', 
                         f'Ajout liste attente: {participant.prenom} {participant.nom}', 
                         f'Session: {session_obj.theme.nom} ({session_obj.formatage_date}) - Pos: {position}', 
                         user=current_user)
                         
            # Notify via WebSocket
            socketio.emit('liste_attente_nouvelle', {
                'session_id': session_id, 
                'participant_id': participant.id, 
                'position': position, 
                'total_session_attente': position
            }, room='general')
            
            flash(f'Ajouté à la liste d\'attente (pos {position}).', 'success')
            return redirect(url_for('dashboard'))
            
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error on waitlist: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except IntegrityError: 
        db.session.rollback()
        flash('Erreur: Déjà en liste attente.', 'danger')
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB liste attente.', 'danger')
        app.logger.error(f"SQLAlchemyError waitlist add: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error waitlist add: {e}")
        
    if request.method == 'POST': 
        return redirect(redirect_url)
        
    return render_template('liste_attente.html', participant=participant, session=session_obj)

@app.route('/validation_inscription/<int:inscription_id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def validation_inscription(inscription_id):
    redirect_url = request.referrer or url_for('dashboard')
    
    try:
        inscription = db.session.get(Inscription, inscription_id)
        
        if not inscription: 
            flash('Inscription introuvable.', 'danger')
            return redirect(redirect_url)
            
        is_admin = current_user.role == 'admin'
        is_responsable = current_user.role == 'responsable' and current_user.service_id == inscription.participant.service_id
        
        if not (is_admin or is_responsable): 
            flash('Action non autorisée.', 'danger')
            return redirect(redirect_url)
            
        action = request.form.get('action')
        participant_name = f"{inscription.participant.prenom} {inscription.participant.nom}"
        session_info = f"Session: {inscription.session.theme.nom} ({inscription.session.formatage_date})"
        session_id = inscription.session_id
        
        if action == 'valider' and inscription.statut == 'en attente':
            if inscription.session.get_places_restantes() <= 0: 
                flash("Impossible valider: session complète.", "warning")
                return redirect(redirect_url)
                
            inscription.statut = 'confirmé'
            inscription.validation_responsable = True
            db.session.commit()
            
            # Invalidate cache for this session
            cache.delete(f'session_counts_{session_id}')
            
            add_activity('validation', f'Validation: {participant_name}', session_info, user=current_user)
            flash('Inscription validée.', 'success')
            
            socketio.emit('inscription_validee', {
                'inscription_id': inscription.id, 
                'session_id': session_id, 
                'participant_id': inscription.participant_id, 
                'new_status': 'confirmé'
            }, room='general')
            
        elif action == 'refuser' and inscription.statut == 'en attente':
            inscription.statut = 'refusé'
            db.session.commit()
            
            # Invalidate cache for this session
            cache.delete(f'session_counts_{session_id}')
            
            add_activity('refus', f'Refus: {participant_name}', session_info, user=current_user)
            flash('Inscription refusée.', 'warning')
            
            socketio.emit('inscription_refusee', {
                'inscription_id': inscription.id, 
                'session_id': session_id, 
                'participant_id': inscription.participant_id, 
                'new_status': 'refusé'
            }, room='general')
            
        elif action == 'annuler' and inscription.statut == 'confirmé':
            inscription.statut = 'annulé'
            db.session.commit()
            
            # Invalidate cache for this session
            cache.delete(f'session_counts_{session_id}')
            
            add_activity('annulation', f'Annulation: {participant_name}', session_info, user=current_user)
            flash('Inscription annulée.', 'success')
            
            check_waitlist(session_id)
            
            socketio.emit('inscription_annulee', {
                'inscription_id': inscription.id, 
                'session_id': session_id, 
                'participant_id': inscription.participant_id, 
                'new_status': 'annulé'
            }, room='general')
            
        else: 
            flash(f"Action '{action}' invalide.", 'warning')
            
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error on validation: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB validation.', 'danger')
        app.logger.error(f"SQLAlchemyError validation: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error validation: {e}")
        
    return redirect(redirect_url)

# --- Participant Management ---
@app.route('/add_participant', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def add_participant():
    redirect_url = request.referrer or url_for('participants')
    try:
        nom = request.form.get('nom', '').strip().upper()
        prenom = request.form.get('prenom', '').strip().capitalize()
        email = request.form.get('email', '').strip().lower()
        service_id = request.form.get('service_id', '').strip()
        
        if not all([nom, prenom, email, service_id]): 
            flash('Champs * obligatoires.', 'danger')
            return redirect(redirect_url)
            
        if '@' not in email or '.' not in email.split('@')[-1]: 
            flash('Email invalide.', 'danger')
            return redirect(redirect_url)
            
        if not db.session.get(Service, service_id): 
            flash('Service invalide.', 'danger')
            return redirect(redirect_url)
            
        participant_existant = Participant.query.filter_by(email=email).first()
        from_page = request.form.get('from_page', 'dashboard')
        redirect_session_id = request.form.get('redirect_session_id')
        action_after_add = request.form.get('action_after_add')
        final_redirect_url = url_for(from_page) if from_page in ['sessions', 'admin', 'dashboard', 'participants'] else url_for('dashboard')

        if participant_existant:
            flash(f'Email déjà utilisé par: {participant_existant.prenom} {participant_existant.nom}.', 'warning')
            if redirect_session_id and action_after_add:
                 flash(f'Sélectionnez {participant_existant.prenom} dans la liste existante.', 'info')
                 return redirect(final_redirect_url)
            return redirect(url_for('participants'))
            
        participant = Participant(nom=nom, prenom=prenom, email=email, service_id=service_id)
        db.session.add(participant)
        db.session.commit()
        
        # Invalidate cache for participants list
        cache.delete('participants_list')
        cache.delete(f'service_participant_count_{service_id}')
        
        add_activity('ajout_participant', 
                     f'Ajout participant: {participant.prenom} {participant.nom}', 
                     f'Service: {participant.service.nom}', 
                     user=current_user)
        flash('Participant ajouté.', 'success')
        
        if redirect_session_id and action_after_add:
            session_obj = db.session.get(Session, int(redirect_session_id))
            if not session_obj: 
                flash("Session introuvable.", "warning")
                return redirect(final_redirect_url)
                
            if action_after_add == 'liste_attente' or session_obj.get_places_restantes() <= 0:
                position = ListeAttente.query.filter_by(session_id=redirect_session_id).count() + 1
                attente = ListeAttente(participant_id=participant.id, session_id=redirect_session_id, position=position)
                db.session.add(attente)
                db.session.commit()
                
                # Invalidate cache for this session
                cache.delete(f'session_counts_{redirect_session_id}')
                
                add_activity('liste_attente', 
                             f'Ajout liste attente (ajout P.): {participant.prenom}', 
                             f'S:{redirect_session_id}, P:{position}', 
                             user=current_user)
                             
                socketio.emit('liste_attente_nouvelle', {
                    'session_id': redirect_session_id, 
                    'participant_id': participant.id, 
                    'position': position, 
                    'total_session_attente': position
                }, room='general')
                
                flash(f'Ajouté et mis en liste attente (pos {position}).', 'success')
                
            else:
                inscription = Inscription(participant_id=participant.id, session_id=redirect_session_id, statut='en attente')
                db.session.add(inscription)
                db.session.commit()
                
                # Invalidate cache for this session
                cache.delete(f'session_counts_{redirect_session_id}')
                
                add_activity('inscription', 
                             f'Demande inscription (ajout P.): {participant.prenom}', 
                             f'S:{redirect_session_id}', 
                             user=current_user)
                             
                socketio.emit('inscription_nouvelle', {
                    'session_id': redirect_session_id, 
                    'participant_id': participant.id, 
                    'statut': 'en attente'
                }, room='general')
                
                flash(f'Ajouté et demande inscription enregistrée (attente validation).', 'success')
                
            return redirect(final_redirect_url)
            
        return redirect(url_for('participants'))
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error add participant: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except IntegrityError: 
        db.session.rollback()
        flash('Erreur: Email déjà existant.', 'danger')
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB ajout participant.', 'danger')
        app.logger.error(f"SQLAlchemyError add participant: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error add participant: {e}")
        
    return redirect(redirect_url)

@app.route('/participants')
@login_required
@db_operation_with_retry(max_retries=3)
def participants():
    if current_user.role not in ['admin', 'responsable']: 
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
        
    try:
        participants = get_all_participants()
        services = get_all_services()
        return render_template('participants.html', participants=participants, services=services)
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error loading participants: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        return render_template('error.html', error_message="Erreur connexion base de données."), 503
        
    except SQLAlchemyError as e: 
        app.logger.error(f"DB error loading participants: {e}")
        flash("Erreur chargement participants.", "danger")
        return redirect(url_for('dashboard'))

@app.route('/update_participant/<int:id>', methods=['POST'])
@login_required
@db_operation_with_retry(max_retries=3)
def update_participant(id):
    participant = db.session.get(Participant, id)
    redirect_url = url_for('participants')
    
    if not participant: 
        flash('Participant introuvable.', 'danger')
        return redirect(redirect_url)
        
    if current_user.role != 'admin' and (current_user.role != 'responsable' or current_user.service_id != participant.service_id): 
        flash('Action non autorisée.', 'danger')
        return redirect(redirect_url)
        
    try:
        original_email = participant.email
        old_service_id = participant.service_id
        new_email = request.form.get('email', '').strip().lower()
        new_service_id = request.form.get('service_id', '').strip()
        
        if new_email != original_email and Participant.query.filter(Participant.email == new_email, Participant.id != id).first(): 
            flash(f'Email {new_email} déjà utilisé.', 'warning')
            return redirect(redirect_url)
            
        participant.nom = request.form.get('nom', '').strip().upper()
        participant.prenom = request.form.get('prenom', '').strip().capitalize()
        participant.email = new_email
        participant.service_id = new_service_id
        
        if not all([participant.nom, participant.prenom, participant.email, participant.service_id]): 
            flash('Champs * obligatoires.', 'danger')
            return redirect(redirect_url)
            
        db.session.commit()
        
        # Invalidate cache
        cache.delete('participants_list')
        if old_service_id != new_service_id:
            cache.delete(f'service_participant_count_{old_service_id}')
            cache.delete(f'service_participant_count_{new_service_id}')
        
        add_activity('modification_participant', 
                     f'Modif participant: {participant.prenom} {participant.nom}', 
                     f'Service: {participant.service.nom}', 
                     user=current_user)
        flash('Participant mis à jour.', 'success')
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error update participant {id}: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB MàJ participant.', 'danger')
        app.logger.error(f"SQLAlchemyError update participant {id}: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error update participant {id}: {e}")
        
    return redirect(redirect_url)

# --- Admin Only Routes ---
@app.route('/admin')
@login_required
@db_operation_with_retry(max_retries=3)
def admin():
    if current_user.role != 'admin': 
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
        
    try:
        themes = get_all_themes()
        sessions = Session.query.order_by(Session.date, Session.heure_debut).all()
        services = get_all_services()
        participants = get_all_participants()
        salles = get_all_salles()
        
        try:
            cache_key = 'admin_stats'
            admin_stats = cache.get(cache_key)
            
            if admin_stats is None:
                total_inscriptions = Inscription.query.filter_by(statut='confirmé').count()
                total_en_attente = ListeAttente.query.count()
                total_sessions_completes = sum(1 for s in sessions if s.get_places_restantes() == 0)
                
                admin_stats = {
                    'total_inscriptions': total_inscriptions,
                    'total_en_attente': total_en_attente,
                    'total_sessions_completes': total_sessions_completes
                }
                cache.set(cache_key, admin_stats, timeout=60)
            else:
                total_inscriptions = admin_stats['total_inscriptions']
                total_en_attente = admin_stats['total_en_attente']
                total_sessions_completes = admin_stats['total_sessions_completes']
        except Exception as count_err:
            app.logger.error(f"Error calculating admin counts: {count_err}")
            total_inscriptions = 0
            total_en_attente = 0
            total_sessions_completes = 0
            
        activites_recentes = Activite.query.order_by(Activite.date.desc()).limit(10).all()
        
        return render_template(
            'admin.html', 
            themes=themes, 
            sessions=sessions, 
            services=services, 
            participants=participants, 
            salles=salles, 
            total_inscriptions=total_inscriptions, 
            total_en_attente=total_en_attente, 
            total_sessions_completes=total_sessions_completes, 
            activites_recentes=activites_recentes
        )
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error loading admin: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        return render_template('error.html', error_message="Erreur connexion base de données."), 503
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        app.logger.error(f"DB error loading admin: {e}")
        flash("Erreur chargement admin.", "danger")
        return render_template('error.html', error_message="DB error."), 500

@app.route('/salles', methods=['GET'])
@login_required
@db_operation_with_retry(max_retries=3)
def salles():
    if current_user.role != 'admin': 
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
        
    try: 
        salles = get_all_salles()
        return render_template('salles.html', salles=salles)
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error loading salles: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        return render_template('error.html', error_message="Erreur connexion base de données."), 503
        
    except SQLAlchemyError as e: 
        app.logger.error(f"DB error loading salles: {e}")
        flash("Erreur chargement salles.", "danger")
        return redirect(url_for('admin'))

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
            flash('Nom et capacité obligatoires.', 'danger')
            return redirect(redirect_url)
            
        try: 
            capacite = int(capacite_str)
            assert capacite > 0
        except (ValueError, AssertionError): 
            flash('Capacité invalide.', 'danger')
            return redirect(redirect_url)
            
        if Salle.query.filter_by(nom=nom).first(): 
            flash(f"Salle '{nom}' existe déjà.", 'warning')
            return redirect(redirect_url)
            
        salle = Salle(nom=nom, capacite=capacite, lieu=lieu or None, description=description or None)
        db.session.add(salle)
        db.session.commit()
        
        # Invalidate cache
        cache.delete('all_salles')
        
        add_activity('ajout_salle', f'Ajout salle: {salle.nom}', f'Capacité: {salle.capacite}', user=current_user)
        flash('Salle ajoutée.', 'success')
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error add salle: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except IntegrityError: 
        db.session.rollback()
        flash('Erreur: Salle déjà existante.', 'danger')
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB ajout salle.', 'danger')
        app.logger.error(f"SQLAlchemyError add salle: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error add salle: {e}")
        
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
        
    try:
        original_nom = salle.nom
        new_nom = request.form.get('nom', '').strip()
        capacite_str = request.form.get('capacite', '').strip()
        
        if not new_nom or not capacite_str: 
            flash('Nom et capacité obligatoires.', 'danger')
            return redirect(redirect_url)
            
        try: 
            capacite = int(capacite_str)
            assert capacite > 0
        except (ValueError, AssertionError): 
            flash('Capacité invalide.', 'danger')
            return redirect(redirect_url)
            
        if new_nom != original_nom and Salle.query.filter(Salle.nom == new_nom, Salle.id != id).first(): 
            flash(f"Nom '{new_nom}' déjà pris.", 'warning')
            return redirect(redirect_url)
            
        salle.nom = new_nom
        salle.capacite = capacite
        salle.lieu = request.form.get('lieu', '').strip() or None
        salle.description = request.form.get('description', '').strip() or None
        
        db.session.commit()
        
        # Invalidate cache
        cache.delete('all_salles')
        
        add_activity('modification_salle', f'Modif salle: {salle.nom}', user=current_user)
        flash('Salle mise à jour.', 'success')
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error update salle {id}: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB MàJ salle.', 'danger')
        app.logger.error(f"SQLAlchemyError update salle {id}: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error update salle {id}: {e}")
        
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
            flash('Session non spécifiée.', 'danger')
            return redirect(redirect_url)
            
        session = db.session.get(Session, session_id)
        
        if not session: 
            flash('Session introuvable.', 'danger')
            return redirect(redirect_url)
            
        new_salle_id = None
        new_salle_nom = "Aucune"
        
        if salle_id_str:
            try: 
                new_salle_id = int(salle_id_str)
                new_salle = db.session.get(Salle, new_salle_id)
            except ValueError: 
                flash("ID salle invalide.", 'danger')
                return redirect(redirect_url)
                
            if not new_salle: 
                flash(f"Salle ID:{new_salle_id} introuvable.", 'danger')
                return redirect(redirect_url)
                
            new_salle_nom = new_salle.nom
            
        session.salle_id = new_salle_id
        db.session.commit()
        
        add_activity('attribution_salle', 
                     f'Attribution salle: {new_salle_nom}', 
                     f'Session: {session.theme.nom} ({session.formatage_date})', 
                     user=current_user)
        flash(f'Salle attribuée: {new_salle_nom}.', 'success')
        
        socketio.emit('attribution_salle', {
            'session_id': session_id, 
            'salle_id': new_salle_id, 
            'salle_nom': new_salle_nom if new_salle_id else None
        }, room='general')
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error assign salle: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB attribution salle.', 'danger')
        app.logger.error(f"SQLAlchemyError assign salle: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error assign salle: {e}")
        
    return redirect(redirect_url)

@app.route('/themes', methods=['GET'])
@login_required
@db_operation_with_retry(max_retries=3)
def themes():
    if current_user.role != 'admin': 
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
        
    try: 
        themes = get_all_themes()
        return render_template('themes.html', themes=themes)
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error loading themes: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        return render_template('error.html', error_message="Erreur connexion base de données."), 503
        
    except SQLAlchemyError as e: 
        app.logger.error(f"DB error loading themes: {e}")
        flash("Erreur chargement thèmes.", "danger")
        return redirect(url_for('admin'))

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
            flash('Nom thème obligatoire.', 'danger')
            return redirect(redirect_url)
            
        if Theme.query.filter_by(nom=nom).first(): 
            flash(f"Thème '{nom}' existe déjà.", 'warning')
            return redirect(redirect_url)
            
        theme = Theme(nom=nom, description=description or None)
        db.session.add(theme)
        db.session.commit()
        
        # Invalidate cache
        cache.delete('all_themes')
        
        add_activity('ajout_theme', f'Ajout thème: {theme.nom}', user=current_user)
        flash('Thème ajouté.', 'success')
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error add theme: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except IntegrityError: 
        db.session.rollback()
        flash('Erreur: Thème déjà existant.', 'danger')
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB ajout thème.', 'danger')
        app.logger.error(f"SQLAlchemyError add theme: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error add theme: {e}")
        
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
            flash('Nom thème obligatoire.', 'danger')
            return redirect(redirect_url)
            
        if new_nom != original_nom and Theme.query.filter(Theme.nom == new_nom, Theme.id != id).first(): 
            flash(f"Nom '{new_nom}' déjà pris.", 'warning')
            return redirect(redirect_url)
            
        theme.nom = new_nom
        theme.description = request.form.get('description', '').strip() or None
        
        db.session.commit()
        
        # Invalidate cache
        cache.delete('all_themes')
        
        add_activity('modification_theme', f'Modif thème: {theme.nom}', user=current_user)
        flash('Thème mis à jour.', 'success')
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error update theme {id}: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB MàJ thème.', 'danger')
        app.logger.error(f"SQLAlchemyError update theme {id}: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error update theme {id}: {e}")
        
    return redirect(redirect_url)

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
            flash('Tous les champs * sont obligatoires.', 'danger')
            return redirect(redirect_url)
            
        if Service.query.filter_by(id=service_id).first(): 
            flash(f"Service ID '{service_id}' existe déjà.", 'warning')
            return redirect(redirect_url)
            
        if Service.query.filter_by(nom=nom).first(): 
            flash(f"Service nom '{nom}' existe déjà.", 'warning')
            return redirect(redirect_url)
            
        service = Service(
            id=service_id,
            nom=nom,
            responsable=responsable,
            email_responsable=email_responsable,
            couleur=couleur or '#6c757d'
        )
        
        db.session.add(service)
        db.session.commit()
        
        # Invalidate cache
        cache.delete('all_services')
        
        add_activity('ajout_service', f'Ajout service: {service.nom}', user=current_user)
        flash('Service ajouté.', 'success')
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error add service: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except IntegrityError as ie: 
        db.session.rollback()
        flash('Erreur: Service déjà existant.', 'danger')
        app.logger.error(f"IntegrityError add service: {ie}")
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB ajout service.', 'danger')
        app.logger.error(f"SQLAlchemyError add service: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error add service: {e}")
        
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
        
        if not new_nom: 
            flash('Nom service obligatoire.', 'danger')
            return redirect(redirect_url)
            
        if new_nom != original_nom and Service.query.filter(Service.nom == new_nom, Service.id != service_id).first(): 
            flash(f"Nom '{new_nom}' déjà pris.", 'warning')
            return redirect(redirect_url)
            
        service.nom = new_nom
        service.responsable = request.form.get('responsable', '').strip()
        service.email_responsable = request.form.get('email_responsable', '').strip().lower()
        service.couleur = request.form.get('couleur', '#6c757d').strip()
        
        if not all([service.responsable, service.email_responsable]): 
            flash('Responsable et email obligatoires.', 'danger')
            return redirect(redirect_url)
            
        db.session.commit()
        
        # Invalidate cache
        cache.delete('all_services')
        cache.delete(f'service_participant_count_{service_id}')
        
        add_activity('modification_service', f'Modif service: {service.nom}', user=current_user)
        flash('Service mis à jour.', 'success')
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error update service {service_id}: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        flash('Erreur DB MàJ service.', 'danger')
        app.logger.error(f"SQLAlchemyError update service {service_id}: {e}")
        
    except Exception as e: 
        db.session.rollback()
        flash('Erreur inattendue.', 'danger')
        app.logger.error(f"Error update service {service_id}: {e}")
        
    return redirect(redirect_url)

@app.route('/activites')
@login_required
def activites():
    if current_user.role != 'admin': 
        flash('Accès réservé.', 'danger')
        return redirect(url_for('dashboard'))
        
    try:
        page = request.args.get('page', 1, type=int)
        per_page = 20
        type_filter = request.args.get('type', '').strip()
        
        query = Activite.query
        if type_filter: 
            query = query.filter(Activite.type == type_filter)
            
        activites_pagination = query.order_by(Activite.date.desc()).paginate(page=page, per_page=per_page, error_out=False)
        return render_template('activites.html', activites=activites_pagination, type_filter=type_filter)
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error loading activities: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        return render_template('error.html', error_message="Erreur connexion base de données."), 503
        
    except SQLAlchemyError as e: 
        app.logger.error(f"DB error loading activities: {e}")
        flash("Erreur chargement journal.", "danger")
        return redirect(url_for('admin'))

# --- API Routes ---
@app.route('/api/sessions')
def api_sessions():
    result = []
    try: 
        sessions = Session.query.options(
            db.joinedload(Session.theme), 
            db.joinedload(Session.salle)
        ).order_by(Session.date, Session.heure_debut).all()
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"API Pool/Conn Error sessions list: {oe}")
        return jsonify({"error": "DB connection/pool error"}), 503
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        app.logger.error(f"API Error sessions list: {e}")
        return jsonify({"error": "DB error"}), 500
        
    for s in sessions:
        try:
            inscrits = s.inscriptions.filter_by(statut='confirmé').count() 
            attente = s.liste_attente.count()
            places = max(0, s.max_participants - inscrits)
            
            salle_nom = None
            salle_id = None
            theme_nom = "N/A"
            theme_id = None
            
            salle_obj = s.salle
            theme_obj = s.theme
            
            if salle_obj: 
                salle_nom = salle_obj.nom
                salle_id = salle_obj.id
                
            if theme_obj: 
                theme_nom = theme_obj.nom
                theme_id = theme_obj.id
                
            result.append({
                'id': s.id, 
                'date': s.formatage_date, 
                'iso_date': s.date.isoformat(), 
                'horaire': s.formatage_horaire, 
                'theme': theme_nom, 
                'theme_id': theme_id, 
                'places_restantes': places, 
                'inscrits': inscrits, 
                'max_participants': s.max_participants, 
                'liste_attente': attente, 
                'salle': salle_nom, 
                'salle_id': salle_id
            })
            
        except (OperationalError, TimeoutError) as oe_inner: 
            db.session.rollback()
            app.logger.error(f"API Pool/Conn Error session count/rel {s.id}: {oe_inner}")
            
        except Exception as e_inner: 
            db.session.rollback()
            app.logger.error(f"API Error session count/rel {s.id}: {e_inner}")
            
    return jsonify(result)

@app.route('/api/sessions/<int:session_id>')
def api_single_session(session_id):
    try:
        session = db.session.get(Session, session_id)
        
        if not session: 
            return jsonify({"error": "Session not found"}), 404
            
        inscrits = session.inscriptions.filter_by(statut='confirmé').count()
        attente = session.liste_attente.count()
        
        result = {
            'id': session.id, 
            'date': session.formatage_date, 
            'iso_date': session.date.isoformat(), 
            'horaire': session.formatage_horaire, 
            'theme': session.theme.nom, 
            'theme_id': session.theme_id,
            'places_restantes': max(0, session.max_participants - inscrits), 
            'inscrits': inscrits, 
            'max_participants': session.max_participants, 
            'liste_attente': attente, 
            'salle': session.salle.nom if session.salle else None, 
            'salle_id': session.salle_id,
            'inscriptions_details': [
                {
                    'id': i.id, 
                    'participant': f"{i.participant.prenom} {i.participant.nom}", 
                    'statut': i.statut
                } for i in session.inscriptions.all()
            ],
            'liste_attente_details': [
                {
                    'id': l.id, 
                    'participant': f"{l.participant.prenom} {l.participant.nom}", 
                    'position': l.position
                } for l in session.liste_attente.order_by(ListeAttente.position).all()
            ]
        }
        
        return jsonify(result)
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"API Pool/Conn Error session {session_id}: {oe}")
        return jsonify({"error": "DB connection/pool error"}), 503
        
    except SQLAlchemyError as e: 
        app.logger.error(f"API Error session {session_id}: {e}")
        return jsonify({"error": "DB error"}), 500

@app.route('/api/participants')
def api_participants():
    result = []
    try: 
        participants = Participant.query.options(
            joinedload(Participant.service)
        ).order_by(Participant.nom, Participant.prenom).all()
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"API Pool/Conn Error participants list: {oe}")
        return jsonify({"error": "DB connection/pool error"}), 503
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        app.logger.error(f"API Error participants list: {e}")
        return jsonify({"error": "DB error"}), 500
        
    for p in participants:
        try:
            confirmed = p.inscriptions.filter_by(statut='confirmé').count()
            waitlist = p.liste_attente.count()
            service_nom = p.service.nom if p.service else "N/A"
            
            result.append({
                'id': p.id, 
                'nom': p.nom, 
                'prenom': p.prenom, 
                'email': p.email, 
                'service': service_nom, 
                'service_id': p.service_id, 
                'inscriptions': confirmed, 
                'en_attente': waitlist
            })
            
        except (OperationalError, TimeoutError) as oe_inner: 
            db.session.rollback()
            app.logger.error(f"API Pool/Conn Error participant count {p.id}: {oe_inner}")
            
        except Exception as e_inner: 
            db.session.rollback()
            app.logger.error(f"API Error participant count {p.id}: {e_inner}")
            
    return jsonify(result)

@app.route('/api/liste_attente/<int:session_id>')
def api_liste_attente(session_id):
    result = []
    try: 
        attentes = ListeAttente.query.filter_by(session_id=session_id).options(
            joinedload(ListeAttente.participant).joinedload(Participant.service)
        ).order_by(ListeAttente.position).all()
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"API Pool/Conn Error waitlist {session_id}: {oe}")
        return jsonify({"error": "DB connection/pool error"}), 503
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        app.logger.error(f"API Error waitlist {session_id}: {e}")
        return jsonify({"error": "DB error"}), 500
        
    for a in attentes: 
        result.append({
            'id': a.id, 
            'participant_id': a.participant_id, 
            'participant': f"{a.participant.prenom} {a.participant.nom}", 
            'service': a.participant.service.nom, 
            'position': a.position, 
            'date_inscription': a.date_inscription.strftime('%d/%m/%Y %H:%M'), 
            'notification_envoyee': a.notification_envoyee
        })
        
    return jsonify(result)

@app.route('/api/salles')
def api_salles():
    result = []
    try: 
        salles = Salle.query.order_by(Salle.nom).all()
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"API Pool/Conn Error salles list: {oe}")
        return jsonify({"error": "DB connection/pool error"}), 503
        
    except SQLAlchemyError as e: 
        db.session.rollback()
        app.logger.error(f"API Error salles list: {e}")
        return jsonify({"error": "DB error"}), 500
        
    for salle in salles:
        try:
            count = salle.sessions.count()
            result.append({
                'id': salle.id, 
                'nom': salle.nom, 
                'capacite': salle.capacite, 
                'lieu': salle.lieu, 
                'description': salle.description, 
                'sessions_count': count
            })
            
        except (OperationalError, TimeoutError) as oe_inner: 
            db.session.rollback()
            app.logger.error(f"API Pool/Conn Error salle count {salle.id}: {oe_inner}")
            # Add minimal data without the count
            result.append({
                'id': salle.id, 
                'nom': salle.nom, 
                'capacite': salle.capacite, 
                'lieu': salle.lieu, 
                'description': salle.description, 
                'sessions_count': 0  # Default value on error
            })
            
        except Exception as e_inner: 
            db.session.rollback()
            app.logger.error(f"API Error salle count {salle.id}: {e_inner}")
            # Add minimal data without the count
            result.append({
                'id': salle.id, 
                'nom': salle.nom, 
                'capacite': salle.capacite, 
                'lieu': salle.lieu, 
                'description': salle.description, 
                'sessions_count': 0  # Default value on error
            })
            
    return jsonify(result)

@app.route('/api/activites')
def api_activites():
    try:
        limit = request.args.get('limit', 10, type=int)
        activites = Activite.query.options(joinedload(Activite.utilisateur)).order_by(Activite.date.desc()).limit(limit).all()
        result = []
        
        for a in activites: 
            result.append({
                'id': a.id, 
                'type': a.type, 
                'description': a.description, 
                'details': a.details, 
                'date_relative': a.date_relative, 
                'date_iso': a.date.isoformat(), 
                'user': a.utilisateur.username if a.utilisateur else None
            })
            
        return jsonify(result)
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"API Pool/Conn Error activities: {oe}")
        return jsonify({"error": "DB connection/pool error"}), 503
        
    except SQLAlchemyError as e: 
        app.logger.error(f"API Error activities: {e}")
        return jsonify({"error": "DB error"}), 500

# --- ICS File Generation Route ---
@app.route('/generer_invitation/<int:inscription_id>')
@login_required
def generer_invitation(inscription_id):
    try:
        # Load inscription with related data using eager loading
        inscription = Inscription.query.options(
            joinedload(Inscription.session).joinedload(Session.theme),
            joinedload(Inscription.session).joinedload(Session.salle),
            joinedload(Inscription.participant)
        ).get(inscription_id)
        
        if not inscription: 
            flash('Inscription introuvable.', 'danger')
            return redirect(url_for('dashboard'))
            
        if inscription.statut != 'confirmé': 
            flash('Invitation seulement pour inscription confirmée.', 'warning')
            return redirect(url_for('dashboard'))
            
        session = inscription.session
        participant = inscription.participant
        salle = session.salle
        
        ics_content = generate_ics(session, participant, salle)
        if ics_content is None: 
            flash('Erreur génération invitation.', 'danger')
            return redirect(url_for('dashboard'))
            
        add_activity(
            'telecharger_invitation', 
            f'Téléchargement invitation: {participant.prenom} {participant.nom}', 
            f'Session: {session.theme.nom} ({session.formatage_date})', 
            user=current_user
        )
        
        # Create safe filename
        filename = f"Formation_{session.theme.nom.replace(' ', '_').replace('/', '_')}_{session.date.strftime('%Y%m%d')}.ics"
        
        # Create response
        response = make_response(ics_content)
        response.headers["Content-Disposition"] = f"attachment; filename=\"{filename}\""
        response.headers["Content-Type"] = "text/calendar; charset=utf-8"
        return response
        
    except (OperationalError, TimeoutError) as oe: 
        db.session.rollback()
        app.logger.error(f"DB Pool/Conn Error generating invitation {inscription_id}: {oe}")
        flash("Erreur connexion/pool DB.", "danger")
        
    except SQLAlchemyError as e: 
        app.logger.error(f"DB error generating invitation {inscription_id}: {e}")
        flash("Erreur DB invitation.", "danger")
        
    except Exception as e: 
        app.logger.error(f"Error generating invitation {inscription_id}: {e}")
        flash("Erreur inattendue invitation.", "danger")
        
    return redirect(url_for('dashboard'))

# === Database Initialization with Enhanced Error Handling ===
def init_db():
    with app.app_context():
        try:
            app.logger.info("Vérification et initialisation de la base de données...")
            db.create_all()
            
            # Check if database connection is working
            if not check_db_connection():
                app.logger.error("Échec de la connexion à la base de données pendant l'initialisation.")
                return False
                
            # Initialize Services
            if Service.query.count() == 0:
                app.logger.info("Initialisation des services...")
                services_data = [
                    {'id':'commerce', 'nom':'Commerce Anecoop-Solagora', 'couleur':'#FFC107', 'responsable':'Andreu MIR SOLAGORA', 'email_responsable':'amir@solagora.com'},
                    {'id':'comptabilite', 'nom':'Comptabilité', 'couleur':'#2196F3', 'responsable':'Lisa VAN SCHOORISSE', 'email_responsable':'lvanschoorisse@anecoop-france.com'},
                    {'id':'florensud', 'nom':'Florensud', 'couleur':'#4CAF50', 'responsable':'Antoine LAMY', 'email_responsable':'a.lamy@florensud.fr'},
                    {'id':'informatique', 'nom':'Informatique', 'couleur':'#607D8B', 'responsable':'BIVIA', 'email_responsable':'kbivia@anecoop-france.com'},
                    {'id':'marketing', 'nom':'Marketing', 'couleur':'#9C27B0', 'responsable':'Camille BROUSSOUX', 'email_responsable':'cbroussoux@anecoop-france.com'},
                    {'id':'qualite', 'nom':'Qualité', 'couleur':'#F44336', 'responsable':'Élodie PHILIBERT', 'email_responsable':'ephilibert@anecoop-france.com'},
                    {'id':'rh', 'nom':'RH', 'couleur':'#FF9800', 'responsable':'Elisabeth GOMEZ', 'email_responsable':'egomez@anecoop-france.com'}
                ]
                
                for data in services_data:
                    db.session.add(Service(**data))
                    
                db.session.commit()
                app.logger.info(f"{len(services_data)} services ajoutés.")
            else:
                app.logger.info("Services déjà présents.")
                
            # Initialize Rooms
            if Salle.query.count() == 0:
                app.logger.info("Initialisation des salles...")
                salles_data = [
                    {'nom':'Salle Madrid', 'capacite':20, 'lieu':'Bâtiment A, 1er étage', 'description':'Grande salle de réunion équipée.'},
                    {'nom':'Salle Barcelone', 'capacite':15, 'lieu':'Bâtiment A, RDC', 'description':'Salle de formation avec postes PC.'},
                    {'nom':'Salle Valence', 'capacite':12, 'lieu':'Bâtiment B, 2ème étage', 'description':'Salle de réunion table en U.'},
                    {'nom':'Salle Murcie', 'capacite':8, 'lieu':'Bâtiment B, 1er étage', 'description':'Petite salle de comité.'}
                ]
                
                for data in salles_data:
                    db.session.add(Salle(**data))
                    
                db.session.commit()
                app.logger.info(f"{len(salles_data)} salles ajoutées.")
            else:
                app.logger.info("Salles déjà présentes.")
                
            # Initialize Themes
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
                update_theme_names()
                
            # Initialize Sessions
            if Session.query.count() == 0:
                app.logger.info("Initialisation des sessions...")
                
                # Fetch required objects with error handling
                try:
                    theme_comm = Theme.query.filter_by(nom='Communiquer avec Teams').first()
                    theme_tasks = Theme.query.filter_by(nom='Gérer les tâches (Planner)').first()
                    theme_files = Theme.query.filter_by(nom='Gérer mes fichiers (OneDrive/SharePoint)').first()
                    theme_collab = Theme.query.filter_by(nom='Collaborer avec Teams').first()
                    salle_madrid = Salle.query.filter_by(nom='Salle Madrid').first()
                    salle_barcelone = Salle.query.filter_by(nom='Salle Barcelone').first()
                    salle_valence = Salle.query.filter_by(nom='Salle Valence').first()
                    
                    if not all([theme_comm, theme_tasks, theme_files, theme_collab, salle_madrid, salle_barcelone, salle_valence]):
                        app.logger.error("ERREUR: Thèmes/Salles manquants pour init sessions.")
                    else:
                        sessions_data = [
                            ('2025-05-13', theme_comm.id, theme_tasks.id, salle_barcelone.id),
                            ('2025-06-03', theme_tasks.id, theme_files.id, salle_madrid.id),
                            ('2025-06-20', theme_files.id, theme_collab.id, salle_valence.id),
                            ('2025-07-01', theme_comm.id, theme_collab.id, salle_madrid.id)
                        ]
                        
                        sessions_added_count = 0
                        for date_str, t1_id, t2_id, s_id in sessions_data:
                            date_obj = date.fromisoformat(date_str)
                            times = [
                                (time(9, 0), time(10, 30), t1_id),
                                (time(10, 45), time(12, 15), t1_id),
                                (time(14, 0), time(15, 30), t2_id),
                                (time(15, 45), time(17, 15), t2_id)
                            ]
                            
                            for start, end, theme_id in times:
                                db.session.add(Session(
                                    date=date_obj, 
                                    heure_debut=start, 
                                    heure_fin=end, 
                                    theme_id=theme_id, 
                                    max_participants=15, 
                                    salle_id=s_id
                                ))
                                sessions_added_count += 1
                                
                        db.session.commit()
                        app.logger.info(f"{sessions_added_count} sessions ajoutées.")
                except Exception as sess_init_err:
                    db.session.rollback()
                    app.logger.error(f"Erreur lors de l'initialisation des sessions: {sess_init_err}")
            else:
                app.logger.info("Sessions déjà présentes.")
                
            # Initialize Users
            if User.query.count() == 0:
                app.logger.info("Initialisation des utilisateurs...")
                
                # Create admin user
                admin_user = User(
                    username='admin', 
                    email='admin@anecoop-france.com', 
                    role='admin'
                )
                admin_user.set_password('Anecoop2025')
                db.session.add(admin_user)
                users_added_count = 1
                
                # Create service responsibles
                services = Service.query.all()
                for service in services:
                    # Create appropriate username
                    username = service.responsable.split()[0].lower()
                    # Normalize username (remove accents, limit length)
                    username = username.replace('é', 'e').replace('è', 'e').replace('ê', 'e') \
                                     .replace('à', 'a').replace('â', 'a') \
                                     .replace('ô', 'o').replace('ù', 'u')[:20]
                    
                    # Ensure username is unique
                    if User.query.filter_by(username=username).first():
                        username = f"{username}_{service.id}"
                    
                    responsable_user = User(
                        username=username,
                        email=service.email_responsable,
                        role='responsable',
                        service_id=service.id
                    )
                    responsable_user.set_password('Anecoop2025')
                    db.session.add(responsable_user)
                    users_added_count += 1
                
                db.session.commit()
                app.logger.info(f"{users_added_count} utilisateurs ajoutés.")
            else:
                app.logger.info("Utilisateurs déjà présents.")
                
            # Initialize Example Participant
            if Participant.query.count() == 0:
                app.logger.info("Ajout participant exemple...")
                qualite_service = Service.query.get('qualite')
                
                if qualite_service:
                    elodie = Participant(
                        nom='PHILIBERT',
                        prenom='Élodie',
                        email='ephilibert@anecoop-france.com',
                        service_id='qualite'
                    )
                    db.session.add(elodie)
                    db.session.commit()
                    app.logger.info("Participant Élodie Philibert ajouté.")
                else:
                    app.logger.warning("Service 'qualite' non trouvé, participant exemple non ajouté.")
                    
            # Initialize Activities Log
            if Activite.query.count() == 0:
                app.logger.info("Ajout activités initiales...")
                admin_user = User.query.filter_by(role='admin').first()
                
                activites_data = [
                    {
                        'type': 'systeme',
                        'description': 'Initialisation application',
                        'details': 'DB et données initiales créées'
                    },
                    {
                        'type': 'systeme',
                        'description': 'Création comptes utilisateurs',
                        'details': 'Admin et responsables créés',
                        'utilisateur_id': admin_user.id if admin_user else None
                    }
                ]
                
                for data in activites_data:
                    db.session.add(Activite(**data))
                    
                db.session.commit()
                app.logger.info("Activités initiales ajoutées.")
                
            app.logger.info("Initialisation DB terminée avec succès.")
            return True
            
        except SQLAlchemyError as e:
            db.session.rollback()
            app.logger.exception(f"ÉCHEC INITIALISATION DB: {e}")
            print(f"ERREUR INIT DB: {e}")
            return False
            
        except Exception as e:
            db.session.rollback()
            app.logger.exception(f"ERREUR INATTENDUE INITIALISATION: {e}")
            print(f"ERREUR INIT: {e}")
            return False

# --- Main Execution ---
if __name__ == '__main__':
    # Setup stdout logging for development
    if app.debug:
        console = logging.StreamHandler()
        console.setLevel(logging.DEBUG)
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        console.setFormatter(formatter)
        app.logger.addHandler(console)
    
    with app.app_context():
        try:
            # 1. Vérifier la connexion DB
            connection_ok = check_db_connection()
            
            if connection_ok:
                print("Connexion DB OK.")
                # 2. Si connexion OK, vérifier si l'init est nécessaire
                if not Service.query.first():
                    print("DB vide, lancement init_db()...")
                    init_success = init_db()
                    if not init_success:
                        print("⚠️ Échec de l'initialisation de la DB.")
                else:
                    print("DB déjà initialisée.")
                    # Refresh theme names if needed
                    try:
                        update_theme_names()
                    except Exception as update_err:
                        print(f"Note: Erreur lors de la mise à jour des noms de thèmes: {update_err}")
            else:
                # Gérer l'échec de la connexion initiale
                print("⚠️ ERREUR CONNEXION DB au démarrage")
                print("Impossible de vérifier/initialiser la DB. L'application pourrait ne pas fonctionner correctement.")
                
        except OperationalError as oe:
            # Gérer l'échec de la connexion initiale
            print(f"⚠️ ERREUR CONNEXION DB au démarrage: {oe}")
            print("Impossible de vérifier/initialiser la DB. L'application pourrait ne pas fonctionner correctement.")
            
        except Exception as e:
            # Gérer d'autres erreurs potentielles lors de la vérification/init
            print(f"⚠️ Erreur lors de la vérification/initialisation de la DB: {e}")
            try:
                db.session.rollback()
            except Exception as rb_e:
                print(f"Erreur supplémentaire pendant le rollback: {rb_e}")

    # Configuration du serveur
    port = int(os.environ.get('PORT', 5000))
    debug_mode = os.environ.get('FLASK_DEBUG') == '1'
    
    # Informations de démarrage
    print(f"Démarrage serveur avec {ASYNC_MODE} sur http://0.0.0.0:{port} (Debug: {debug_mode})")
    print(f"Version optimisée avec gestion d'erreurs améliorée")
    
    # Exécute avec SocketIO, en utilisant eventlet si disponible
    socketio.run(
        app, 
        host='0.0.0.0', 
        port=port, 
        use_reloader=False,  # use_reloader=False avec eventlet
        debug=debug_mode,
        log_output=False     # Désactiver la sortie log SocketIO brute
    )

# --- END OF COMPLETE app.py (Optimized Version) ---
