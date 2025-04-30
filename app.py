# app.py
# Formation Manager - Application de gestion des formations Microsoft 365

import os
import psycopg2
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, make_response
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from datetime import datetime, timedelta
import os
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_socketio import SocketIO, emit, join_room, leave_room
from datetime import datetime, timedelta
import json

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'default-secret-key-for-dev')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'postgresql://xvcyuaga:rfodwjclemtvhwvqsrpp@alpha.europe.mkdb.sh:5432/usdtdsgq')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
migrate = Migrate(app, db)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
socketio = SocketIO(app, cors_allowed_origins="*")

# Modèles de base de données
class Service(db.Model):
    id = db.Column(db.String(20), primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    couleur = db.Column(db.String(7), nullable=False)
    responsable = db.Column(db.String(100), nullable=False)
    email_responsable = db.Column(db.String(100), nullable=False)
    participants = db.relationship('Participant', backref='service', lazy=True)

class Salle(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    capacite = db.Column(db.Integer, default=15)
    lieu = db.Column(db.String(200), nullable=True)
    description = db.Column(db.Text, nullable=True)
    sessions = db.relationship('Session', backref='salle', lazy=True)

class Theme(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    sessions = db.relationship('Session', backref='theme', lazy=True)

class Session(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False)
    heure_debut = db.Column(db.Time, nullable=False)
    heure_fin = db.Column(db.Time, nullable=False)
    theme_id = db.Column(db.Integer, db.ForeignKey('theme.id'), nullable=False)
    max_participants = db.Column(db.Integer, default=15)
    inscriptions = db.relationship('Inscription', backref='session', lazy=True)
    liste_attente = db.relationship('ListeAttente', backref='session', lazy=True)
    salle_id = db.Column(db.Integer, db.ForeignKey('salle.id'), nullable=True)
    
    @property
    def places_restantes(self):
        inscriptions_confirmees = Inscription.query.filter_by(session_id=self.id, statut='confirmé').count()
        return self.max_participants - inscriptions_confirmees
    
    @property
    def formatage_date(self):
        # Format: "mardi 13 mai 2025"
        jour_semaine = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
        mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
        return f"{jour_semaine[self.date.weekday()]} {self.date.day} {mois[self.date.month-1]} {self.date.year}"
    
    @property
    def formatage_horaire(self):
        # Format: "09 h 00 – 10 h 30"
        debut = f"{self.heure_debut.hour:02d} h {self.heure_debut.minute:02d}"
        fin = f"{self.heure_fin.hour:02d} h {self.heure_fin.minute:02d}"
        return f"{debut} – {fin}"
    
    @property
    def formatage_ics(self):
        # Format pour fichier ICS
        date_debut = datetime.combine(self.date, self.heure_debut)
        date_fin = datetime.combine(self.date, self.heure_fin)
        return date_debut, date_fin

class Participant(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    prenom = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=False)
    inscriptions = db.relationship('Inscription', backref='participant', lazy=True)
    liste_attente = db.relationship('ListeAttente', backref='participant', lazy=True)

class Inscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False)
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False)
    date_inscription = db.Column(db.DateTime, default=datetime.utcnow)
    statut = db.Column(db.String(20), default='confirmé')  # confirmé, en attente, annulé
    validation_responsable = db.Column(db.Boolean, default=False)
    presence = db.Column(db.Boolean, default=False)
    notification_envoyee = db.Column(db.Boolean, default=False)
    
    __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_inscription'),)

class ListeAttente(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    participant_id = db.Column(db.Integer, db.ForeignKey('participant.id'), nullable=False)
    session_id = db.Column(db.Integer, db.ForeignKey('session.id'), nullable=False)
    date_inscription = db.Column(db.DateTime, default=datetime.utcnow)
    position = db.Column(db.Integer, nullable=False)
    notification_envoyee = db.Column(db.Boolean, default=False)
    
    __table_args__ = (db.UniqueConstraint('participant_id', 'session_id', name='uix_liste_attente'),)

class Activite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(50), nullable=False)  # inscription, validation, liste_attente
    description = db.Column(db.Text, nullable=False)
    details = db.Column(db.Text, nullable=True)
    date = db.Column(db.DateTime, default=datetime.utcnow)
    utilisateur_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    
    @property
    def date_relative(self):
        """Renvoie la date relative (il y a X minutes/heures/jours)"""
        now = datetime.utcnow()
        diff = now - self.date
        
        if diff.days > 0:
            return f"il y a {diff.days} jour{'s' if diff.days > 1 else ''}"
        elif diff.seconds // 3600 > 0:
            hours = diff.seconds // 3600
            return f"il y a {hours} heure{'s' if hours > 1 else ''}"
        elif diff.seconds // 60 > 0:
            minutes = diff.seconds // 60
            return f"il y a {minutes} minute{'s' if minutes > 1 else ''}"
        else:
            return "à l'instant"

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    role = db.Column(db.String(20), default='user')  # admin, responsable, user
    service_id = db.Column(db.String(20), db.ForeignKey('service.id'), nullable=True)
    activites = db.relationship('Activite', backref='utilisateur', lazy=True)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
        
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Helpers et utilitaires
def generate_ics(session, participant, salle=None):
    """Génère un fichier ICS pour l'invitation calendrier"""
    from ics import Calendar, Event
    
    cal = Calendar()
    event = Event()
    
    date_debut, date_fin = session.formatage_ics
    
    event.name = f"Formation: {session.theme.nom}"
    event.begin = date_debut
    event.end = date_fin
    
    description = f"Formation Microsoft 365\n\n"
    description += f"Thème: {session.theme.nom}\n"
    description += f"Date: {session.formatage_date}\n"
    description += f"Horaire: {session.formatage_horaire}\n"
    
    if salle:
        description += f"\nLieu: {salle.nom}"
        if salle.lieu:
            description += f"\nAdresse: {salle.lieu}"
        event.location = salle.nom
    
    description += f"\n\nParticipant: {participant.prenom} {participant.nom}"
    
    event.description = description
    
    # Ajouter un rappel 1 heure avant
    event.alarms = [{"action": "DISPLAY", "trigger": timedelta(hours=-1)}]
    
    cal.events.add(event)
    return cal.serialize()

def check_waitlist(session_id):
    """Vérifie la liste d'attente et notifie le premier en attente si une place se libère"""
    session = Session.query.get(session_id)
    
    if session.places_restantes > 0:
        # Chercher la première personne en liste d'attente
        premier_attente = ListeAttente.query.filter_by(
            session_id=session_id,
            notification_envoyee=False
        ).order_by(ListeAttente.position).first()
        
        if premier_attente:
            # Marquer comme notifié
            premier_attente.notification_envoyee = True
            db.session.commit()
            
            # Émettre une notification via WebSocket
            socketio.emit('notification', {
                'type': 'place_disponible',
                'message': f'Une place s\'est libérée pour la session {session.theme.nom} du {session.formatage_date}',
                'participant_id': premier_attente.participant_id,
                'session_id': session_id
            })
            
            # Enregistrer l'activité
            activite = Activite(
                type='notification',
                description=f'Notification de place disponible',
                details=f'Session: {session.theme.nom} ({session.formatage_date})',
                utilisateur_id=current_user.id if current_user.is_authenticated else None
            )
            db.session.add(activite)
            db.session.commit()
            
            return True
    
    return False

def add_activity(type, description, details=None):
    """Ajoute une activité dans le journal"""
    activite = Activite(
        type=type,
        description=description,
        details=details,
        utilisateur_id=current_user.id if current_user.is_authenticated else None
    )
    db.session.add(activite)
    db.session.commit()
    
    # Émettre une notification via WebSocket
    socketio.emit('nouvelle_activite', {
        'id': activite.id,
        'type': activite.type,
        'description': activite.description,
        'date_relative': activite.date_relative
    })

# Routes pour WebSocket
@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('join')
def handle_join(data):
    room = data.get('room')
    join_room(room)
    print(f'Client joined room: {room}')

# Routes de l'application
@app.route('/')
def index():
    # Rediriger vers le dashboard pour assurer la cohérence
    return redirect(url_for('dashboard'))

@app.route('/dashboard')
def dashboard():
    themes = Theme.query.all()
    sessions = Session.query.order_by(Session.date, Session.heure_debut).all()
    services = Service.query.all()
    participants = Participant.query.all()
    salles = Salle.query.all()
    
    # Statistiques pour le dashboard
    total_inscriptions = Inscription.query.filter_by(statut='confirmé').count()
    total_en_attente = ListeAttente.query.count()
    total_sessions_completes = sum(1 for s in sessions if s.places_restantes == 0)
    
    # Récupérer les activités récentes (10 dernières)
    activites_recentes = Activite.query.order_by(Activite.date.desc()).limit(10).all()
    
    return render_template(
        'dashboard.html', 
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

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            next_page = request.args.get('next', url_for('dashboard'))
            
            # Enregistrer l'activité de connexion
            add_activity('connexion', f'Connexion de {user.username}')
            
            return redirect(next_page)
        else:
            flash('Identifiants incorrects', 'danger')
    
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    # Enregistrer l'activité de déconnexion
    add_activity('deconnexion', f'Déconnexion de {current_user.username}')
    
    logout_user()
    flash('Vous avez été déconnecté avec succès', 'success')
    return redirect(url_for('index'))

@app.route('/services')
def services():
    services = Service.query.all()
    return render_template('services.html', services=services)

@app.route('/sessions')
def sessions():
    # Récupération de toutes les données nécessaires
    sessions = Session.query.order_by(Session.date, Session.heure_debut).all()
    themes = Theme.query.all()
    participants = Participant.query.all()
    
    # Filtres
    theme_id = request.args.get('theme')
    date = request.args.get('date')
    places = request.args.get('places')
    
    # Application des filtres
    if theme_id:
        sessions = [s for s in sessions if str(s.theme_id) == theme_id]
    
    if date:
        date_obj = datetime.strptime(date, '%Y-%m-%d').date()
        sessions = [s for s in sessions if s.date == date_obj]
    
    if places == 'available':
        sessions = [s for s in sessions if s.places_restantes > 0]
    
    return render_template('sessions.html', sessions=sessions, themes=themes, participants=participants)

@app.route('/inscription', methods=['POST'])
def inscription():
    if request.method == 'POST':
        participant_id = request.form.get('participant_id')
        session_id = request.form.get('session_id')
        
        if not participant_id or not session_id:
            flash('Informations manquantes', 'danger')
            return redirect(url_for('dashboard'))
        
        # Récupérer les objets participant et session
        participant = Participant.query.get(participant_id)
        session_obj = Session.query.get(session_id)
        
        if not participant or not session_obj:
            flash('Participant ou session introuvable', 'danger')
            return redirect(url_for('dashboard'))
        
        # Vérifier si l'inscription existe déjà
        inscription_existante = Inscription.query.filter_by(
            participant_id=participant_id, 
            session_id=session_id
        ).first()
        
        if inscription_existante:
            flash('Ce participant est déjà inscrit à cette session', 'warning')
            return redirect(url_for('dashboard'))
            
        # Vérifier s'il reste des places
        if session_obj.places_restantes <= 0:
            # Proposer la liste d'attente
            return redirect(url_for('liste_attente', participant_id=participant_id, session_id=session_id))
            
        # Créer l'inscription
        inscription = Inscription(
            participant_id=participant_id,
            session_id=session_id,
            statut='en attente'
        )
        
        db.session.add(inscription)
        db.session.commit()
        
        # Enregistrer l'activité
        add_activity(
            'inscription', 
            f'Inscription de {participant.prenom} {participant.nom}',
            f'Session: {session_obj.theme.nom} ({session_obj.formatage_date})'
        )
        
        # Notification WebSocket
        socketio.emit('inscription_nouvelle', {
            'session_id': session_id,
            'places_restantes': session_obj.places_restantes - 1
        })
        
        flash('Inscription enregistrée avec succès', 'success')
        return redirect(url_for('dashboard'))

@app.route('/liste_attente', methods=['GET', 'POST'])
def liste_attente():
    participant_id = request.args.get('participant_id') or request.form.get('participant_id')
    session_id = request.args.get('session_id') or request.form.get('session_id')
    
    if not participant_id or not session_id:
        flash('Informations manquantes', 'danger')
        return redirect(url_for('dashboard'))
    
    participant = Participant.query.get(participant_id)
    session_obj = Session.query.get(session_id)
    
    if not participant or not session_obj:
        flash('Participant ou session introuvable', 'danger')
        return redirect(url_for('dashboard'))
    
    # Vérifier si déjà en liste d'attente
    deja_en_attente = ListeAttente.query.filter_by(
        participant_id=participant_id,
        session_id=session_id
    ).first()
    
    if deja_en_attente:
        flash(f"Vous êtes déjà en liste d'attente (position {deja_en_attente.position})", 'info')
        return redirect(url_for('dashboard'))
    
    if request.method == 'POST':
        # Déterminer la position dans la liste d'attente
        position = ListeAttente.query.filter_by(session_id=session_id).count() + 1
        
        # Ajouter à la liste d'attente
        attente = ListeAttente(
            participant_id=participant_id,
            session_id=session_id,
            position=position
        )
        
        db.session.add(attente)
        db.session.commit()
        
        # Enregistrer l'activité
        add_activity(
            'liste_attente', 
            f'Ajout en liste d\'attente de {participant.prenom} {participant.nom}',
            f'Session: {session_obj.theme.nom} ({session_obj.formatage_date}) - Position: {position}'
        )
        
        # Notification WebSocket
        socketio.emit('liste_attente_nouvelle', {
            'session_id': session_id,
            'position': position,
            'total_en_attente': ListeAttente.query.count()
        })
        
        flash(f'Vous avez été ajouté à la liste d\'attente (position {position})', 'success')
        return redirect(url_for('dashboard'))
    
    return render_template('liste_attente.html', participant=participant, session=session_obj)

@app.route('/validation_inscription/<int:inscription_id>', methods=['POST'])
@login_required
def validation_inscription(inscription_id):
    if current_user.role not in ['admin', 'responsable']:
        flash('Vous n\'avez pas les droits pour valider une inscription', 'danger')
        return redirect(url_for('dashboard'))
        
    inscription = Inscription.query.get_or_404(inscription_id)
    action = request.form.get('action')
    
    if action == 'valider':
        inscription.validation_responsable = True
        inscription.statut = 'confirmé'
        
        # Enregistrer l'activité
        add_activity(
            'validation', 
            f'Validation de l\'inscription de {inscription.participant.prenom} {inscription.participant.nom}',
            f'Session: {inscription.session.theme.nom} ({inscription.session.formatage_date})'
        )
        
        flash('Inscription validée avec succès', 'success')
        
        # Vérifier si la session a une salle attribuée
        salle = None
        if inscription.session.salle_id:
            salle = Salle.query.get(inscription.session.salle_id)
        
        # Notification WebSocket
        socketio.emit('inscription_validee', {
            'participant_id': inscription.participant_id,
            'session_id': inscription.session_id,
            'inscription_id': inscription.id,
            'total_inscriptions': Inscription.query.filter_by(statut='confirmé').count()
        })
        
    elif action == 'refuser':
        inscription.validation_responsable = False
        inscription.statut = 'annulé'
        
        # Enregistrer l'activité
        add_activity(
            'refus', 
            f'Refus de l\'inscription de {inscription.participant.prenom} {inscription.participant.nom}',
            f'Session: {inscription.session.theme.nom} ({inscription.session.formatage_date})'
        )
        
        flash('Inscription refusée', 'warning')
        
        # Vérifier la liste d'attente
        check_waitlist(inscription.session_id)
        
        # Notification WebSocket
        socketio.emit('inscription_refusee', {
            'participant_id': inscription.participant_id,
            'session_id': inscription.session_id,
            'inscription_id': inscription.id
        })
    
    db.session.commit()
    return redirect(url_for('dashboard'))

@app.route('/add_participant', methods=['POST'])
def add_participant():
    if request.method == 'POST':
        nom = request.form.get('nom')
        prenom = request.form.get('prenom')
        email = request.form.get('email')
        service_id = request.form.get('service_id')
        
        if not nom or not prenom or not email or not service_id:
            flash('Tous les champs sont obligatoires', 'danger')
            return redirect(url_for('dashboard'))
        
        # Vérifier si le participant existe déjà (par email)
        participant_existant = Participant.query.filter_by(email=email).first()
        if participant_existant:
            flash(f'Un participant avec cet email existe déjà: {participant_existant.prenom} {participant_existant.nom}', 'warning')
            return redirect(url_for('dashboard'))
        
        # Créer le participant
        participant = Participant(
            nom=nom.upper(),
            prenom=prenom.capitalize(),
            email=email.lower(),
            service_id=service_id
        )
        
        db.session.add(participant)
        db.session.commit()
        
        # Enregistrer l'activité
        add_activity(
            'ajout_participant', 
            f'Ajout du participant {participant.prenom} {participant.nom}',
            f'Service: {participant.service.nom}'
        )
        
        flash('Participant ajouté avec succès', 'success')
        
        # Si l'ajout vient d'une inscription à une session
        session_id = request.form.get('session_id')
        if session_id:
            return redirect(url_for('inscription', participant_id=participant.id, session_id=session_id))
        
        return redirect(url_for('dashboard'))

@app.route('/salles', methods=['GET'])
@login_required
def salles():
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs', 'danger')
        return redirect(url_for('dashboard'))
    
    salles = Salle.query.all()
    return render_template('salles.html', salles=salles)

@app.route('/add_salle', methods=['POST'])
@login_required
def add_salle():
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs', 'danger')
        return redirect(url_for('dashboard'))
    
    if request.method == 'POST':
        nom = request.form.get('nom')
        capacite = request.form.get('capacite')
        lieu = request.form.get('lieu')
        description = request.form.get('description')
        
        if not nom or not capacite:
            flash('Le nom et la capacité sont obligatoires', 'danger')
            return redirect(url_for('salles'))
        
        salle = Salle(
            nom=nom,
            capacite=capacite,
            lieu=lieu,
            description=description
        )
        
        db.session.add(salle)
        db.session.commit()
        
        # Enregistrer l'activité
        add_activity(
            'ajout_salle', 
            f'Ajout de la salle {salle.nom}',
            f'Capacité: {salle.capacite} places'
        )
        
        flash('Salle ajoutée avec succès', 'success')
        return redirect(url_for('salles'))

@app.route('/update_salle/<int:id>', methods=['POST'])
@login_required
def update_salle(id):
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs', 'danger')
        return redirect(url_for('dashboard'))
    
    salle = Salle.query.get_or_404(id)
    
    if request.method == 'POST':
        salle.nom = request.form.get('nom')
        salle.capacite = request.form.get('capacite')
        salle.lieu = request.form.get('lieu')
        salle.description = request.form.get('description')
        
        db.session.commit()
        
        # Enregistrer l'activité
        add_activity(
            'modification_salle', 
            f'Modification de la salle {salle.nom}'
        )
        
        flash('Salle mise à jour avec succès', 'success')
        return redirect(url_for('salles'))

@app.route('/attribuer_salle', methods=['POST'])
@login_required
def attribuer_salle():
    if current_user.role != 'admin':
        flash('Accès réservé aux administrateurs', 'danger')
        return redirect(url_for('dashboard'))
    
    if request.method == 'POST':
        session_id = request.form.get('session_id')
        salle_id = request.form.get('salle_id')
        
        if not session_id or not salle_id:
            flash('Session et salle sont requises', 'danger')
            return redirect(url_for('dashboard'))
        
        session = Session.query.get(session_id)
        if not session:
            flash('Session introuvable', 'danger')
            return redirect(url_for('dashboard'))
        
        # Mémoriser l'ancienne salle pour l'activité
        ancienne_salle = None
        if session.salle_id:
            ancienne_salle = Salle.query.get(session.salle_id)
        
        session.salle_id = salle_id
        db.session.commit()
        
        # Récupérer la nouvelle salle
        nouvelle_salle = Salle.query.get(salle_id)
        
        # Enregistrer l'activité
        add_activity(
            'attribution_salle', 
            f'Attribution de la salle {nouvelle_salle.nom} à une session',
            f'Session: {session.theme.nom} ({session.formatage_date})'
        )
        
        flash('Salle attribuée avec succès', 'success')
        
        # Notification WebSocket
        socketio.emit('attribution_salle', {
            'session_id': session_id,
            'salle_id': salle_id,
            'salle_nom': nouvelle_salle.nom
        })
        
        return redirect(url_for('dashboard'))

@app.route('/generer_invitation/<int:inscription_id>')
def generer_invitation(inscription_id):
    inscription = Inscription.query.get_or_404(inscription_id)
    
    if inscription.statut != 'confirmé':
        flash('L\'inscription n\'est pas confirmée', 'warning')
        return redirect(url_for('dashboard'))
    
    session = inscription.session
    participant = inscription.participant
    salle = None
    
    if session.salle_id:
        salle = Salle.query.get(session.salle_id)
    
    ics_content = generate_ics(session, participant, salle)
    
    # Enregistrer l'activité
    if current_user.is_authenticated:
        add_activity(
            'telecharger_invitation', 
            f'Téléchargement de l\'invitation pour {participant.prenom} {participant.nom}',
            f'Session: {session.theme.nom} ({session.formatage_date})'
        )
    
    response = make_response(ics_content)
    response.headers["Content-Disposition"] = f"attachment; filename=formation_{session.theme.nom.replace(' ', '_')}_{session.date}.ics"
    response.headers["Content-Type"] = "text/calendar"
    
    return response

@app.route('/api/sessions')
def api_sessions():
    sessions = Session.query.all()
    result = []
    
    for session in sessions:
        inscriptions_confirmees = Inscription.query.filter_by(session_id=session.id, statut='confirmé').count()
        attente_count = ListeAttente.query.filter_by(session_id=session.id).count()
        
        result.append({
            'id': session.id,
            'date': session.formatage_date,
            'horaire': session.formatage_horaire,
            'theme': session.theme.nom,
            'theme_id': session.theme_id,
            'places_restantes': session.max_participants - inscriptions_confirmees,
            'inscrits': inscriptions_confirmees,
            'max_participants': session.max_participants,
            'liste_attente': attente_count,
            'salle': session.salle.nom if session.salle else None
        })
    
    return jsonify(result)

@app.route('/api/participants')
def api_participants():
    participants = Participant.query.all()
    result = []
    
    for participant in participants:
        inscriptions = Inscription.query.filter_by(participant_id=participant.id, statut='confirmé').count()
        en_attente = ListeAttente.query.filter_by(participant_id=participant.id).count()
        
        result.append({
            'id': participant.id,
            'nom': participant.nom,
            'prenom': participant.prenom,
            'email': participant.email,
            'service': participant.service.nom,
            'service_id': participant.service_id,
            'inscriptions': inscriptions,
            'en_attente': en_attente
        })
    
    return jsonify(result)

@app.route('/api/liste_attente/<int:session_id>')
def api_liste_attente(session_id):
    attentes = ListeAttente.query.filter_by(session_id=session_id).order_by(ListeAttente.position).all()
    result = []
    
    for attente in attentes:
        result.append({
            'id': attente.id,
            'participant': f"{attente.participant.prenom} {attente.participant.nom}",
            'service': attente.participant.service.nom,
            'position': attente.position,
            'date_inscription': attente.date_inscription.strftime('%d/%m/%Y %H:%M')
        })
    
    return jsonify(result)

@app.route('/api/salles')
def api_salles():
    salles = Salle.query.all()
    result = []
    
    for salle in salles:
        # Compter les sessions qui utilisent cette salle
        sessions_count = Session.query.filter_by(salle_id=salle.id).count()
        
        result.append({
            'id': salle.id,
            'nom': salle.nom,
            'capacite': salle.capacite,
            'lieu': salle.lieu,
            'description': salle.description,
            'sessions_count': sessions_count
        })
    
    return jsonify(result)

@app.route('/api/activites')
def api_activites():
    activites = Activite.query.order_by(Activite.date.desc()).limit(20).all()
    result = []
    
    for activite in activites:
        result.append({
            'id': activite.id,
            'type': activite.type,
            'description': activite.description,
            'details': activite.details,
            'date_relative': activite.date_relative,
            'date': activite.date.strftime('%d/%m/%Y %H:%M')
        })
    
    return jsonify(result)

# Initialisation des données
def init_db():
    with app.app_context():
        db.create_all()
        
        # Vérifier si les données existent déjà
        if Service.query.count() == 0:
            # Services
            services = [
                Service(id='commerce', nom='Commerce Anecoop-Solagora', couleur='#FFC107', responsable='Andreu MIR SOLAGORA', email_responsable='amir@solagora.com'),
                Service(id='comptabilite', nom='Comptabilité', couleur='#2196F3', responsable='Lisa VAN SCHOORISSE', email_responsable='lvanschoorisse@anecoop-france.com'),
                Service(id='florensud', nom='Florensud', couleur='#4CAF50', responsable='Antoine LAMY', email_responsable='a.lamy@florensud.fr'),
                Service(id='informatique', nom='Informatique', couleur='#607D8B', responsable='BIVIA', email_responsable='kbivia@anecoop-france.com'),
                Service(id='marketing', nom='Marketing', couleur='#9C27B0', responsable='Camille BROUSSOUX', email_responsable='cbroussoux@anecoop-france.com'),
                Service(id='qualite', nom='Qualité', couleur='#F44336', responsable='Élodie PHILIBERT', email_responsable='ephilibert@anecoop-france.com'),
                Service(id='rh', nom='RH', couleur='#FF9800', responsable='Elisabeth GOMEZ', email_responsable='egomez@anecoop-france.com')
            ]
            db.session.add_all(services)
            
            # Salles
            salles = [
                Salle(nom='Salle Madrid', capacite=20, lieu='Bâtiment A, 1er étage', description='Grande salle de réunion équipée d\'un vidéoprojecteur et d\'un tableau blanc'),
                Salle(nom='Salle Barcelone', capacite=15, lieu='Bâtiment A, rez-de-chaussée', description='Salle de formation avec 15 postes informatiques'),
                Salle(nom='Salle Valence', capacite=12, lieu='Bâtiment B, 2ème étage', description='Salle de réunion avec table en U'),
                Salle(nom='Salle Murcie', capacite=8, lieu='Bâtiment B, 1er étage', description='Petite salle pour réunions ou formations en petit comité')
            ]
            db.session.add_all(salles)
            
            # Thèmes (modifications demandées pour SharePoint/OneDrive et Collaborer Teams)
            themes = [
                Theme(nom='Communiquer avec Teams', description='Apprenez à utiliser Microsoft Teams pour communiquer efficacement avec vos collègues.'),
                Theme(nom='Gérer les tâches (Planner)', description='Maîtrisez la gestion des tâches d\'équipe avec les outils Microsoft.'),
                Theme(nom='Gérer mes fichiers (OneDrive/SharePoint)', description='Apprenez à organiser et partager vos fichiers avec OneDrive et SharePoint.'),
                Theme(nom='Collaborer avec Teams', description='Découvrez comment collaborer sur des documents avec Microsoft Teams.')
            ]
            db.session.add_all(themes)
            db.session.commit()
            
            # Sessions - NOTA: Inverser les sessions du 1er juillet comme demandé
            sessions_data = [
                # 13 mai 2025
                {'date': '2025-05-13', 'debut': '09:00', 'fin': '10:30', 'theme': 'Communiquer avec Teams', 'salle': 'Salle Barcelone'},
                {'date': '2025-05-13', 'debut': '10:45', 'fin': '12:15', 'theme': 'Communiquer avec Teams', 'salle': 'Salle Barcelone'},
                {'date': '2025-05-13', 'debut': '14:00', 'fin': '15:30', 'theme': 'Gérer les tâches (Planner)', 'salle': 'Salle Barcelone'},
                {'date': '2025-05-13', 'debut': '15:45', 'fin': '17:15', 'theme': 'Gérer les tâches (Planner)', 'salle': 'Salle Barcelone'},
                # 3 juin 2025
                {'date': '2025-06-03', 'debut': '09:00', 'fin': '10:30', 'theme': 'Gérer les tâches (Planner)', 'salle': 'Salle Madrid'},
                {'date': '2025-06-03', 'debut': '10:45', 'fin': '12:15', 'theme': 'Gérer les tâches (Planner)', 'salle': 'Salle Madrid'},
                {'date': '2025-06-03', 'debut': '14:00', 'fin': '15:30', 'theme': 'Gérer mes fichiers (OneDrive/SharePoint)', 'salle': 'Salle Madrid'},
                {'date': '2025-06-03', 'debut': '15:45', 'fin': '17:15', 'theme': 'Gérer mes fichiers (OneDrive/SharePoint)', 'salle': 'Salle Madrid'},
                # 20 juin 2025
                {'date': '2025-06-20', 'debut': '09:00', 'fin': '10:30', 'theme': 'Gérer mes fichiers (OneDrive/SharePoint)', 'salle': 'Salle Valence'},
                {'date': '2025-06-20', 'debut': '10:45', 'fin': '12:15', 'theme': 'Gérer mes fichiers (OneDrive/SharePoint)', 'salle': 'Salle Valence'},
                {'date': '2025-06-20', 'debut': '14:00', 'fin': '15:30', 'theme': 'Collaborer avec Teams', 'salle': 'Salle Valence'},
                {'date': '2025-06-20', 'debut': '15:45', 'fin': '17:15', 'theme': 'Collaborer avec Teams', 'salle': 'Salle Valence'},
                # 1er juillet 2025 - Inversé comme demandé: Communiquer avant Collaborer
                {'date': '2025-07-01', 'debut': '09:00', 'fin': '10:30', 'theme': 'Communiquer avec Teams', 'salle': 'Salle Madrid'},
                {'date': '2025-07-01', 'debut': '10:45', 'fin': '12:15', 'theme': 'Communiquer avec Teams', 'salle': 'Salle Madrid'},
                {'date': '2025-07-01', 'debut': '14:00', 'fin': '15:30', 'theme': 'Collaborer avec Teams', 'salle': 'Salle Madrid'},
                {'date': '2025-07-01', 'debut': '15:45', 'fin': '17:15', 'theme': 'Collaborer avec Teams', 'salle': 'Salle Madrid'}
            ]
            
            for session_data in sessions_data:
                theme = Theme.query.filter_by(nom=session_data['theme']).first()
                salle = Salle.query.filter_by(nom=session_data['salle']).first()
                
                if not theme:
                    print(f"Thème introuvable: {session_data['theme']}")
                    continue
                
                session = Session(
                    date=datetime.strptime(session_data['date'], '%Y-%m-%d').date(),
                    heure_debut=datetime.strptime(session_data['debut'], '%H:%M').time(),
                    heure_fin=datetime.strptime(session_data['fin'], '%H:%M').time(),
                    theme_id=theme.id,
                    max_participants=15,
                    salle_id=salle.id if salle else None
                )
                db.session.add(session)
                
            # Ajouter un utilisateur admin
            admin = User(
                username='admin',
                email='admin@anecoop-france.com',
                role='admin'
            )
            admin.set_password('Anecoop2025')
            db.session.add(admin)
            
            # Ajouter des utilisateurs responsables
            for service in services:
                username = service.responsable.split()[0].lower()
                responsable = User(
                    username=username,
                    email=service.email_responsable,
                    role='responsable',
                    service_id=service.id
                )
                responsable.set_password('Anecoop2025')
                db.session.add(responsable)
            
            # Ajouter Élodie Philibert en tant que participant
            elodie = Participant(
                nom='PHILIBERT',
                prenom='Élodie',
                email='ephilibert@anecoop-france.com',
                service_id='qualite'
            )
            db.session.add(elodie)
            
            db.session.commit()
            
            # Ajouter les inscriptions d'Élodie (selon l'image)
            theme_collab = Theme.query.filter_by(nom='Collaborer avec Teams').first()
            sessions_elodie = Session.query.filter(
                ((Session.date == datetime.strptime('2025-05-13', '%Y-%m-%d').date()) |
                (Session.date == datetime.strptime('2025-06-03', '%Y-%m-%d').date()) |
                (Session.date == datetime.strptime('2025-06-20', '%Y-%m-%d').date()) |
                (Session.date == datetime.strptime('2025-07-01', '%Y-%m-%d').date())) &
                (Session.theme_id != theme_collab.id if theme_collab else True)
            ).all()
            
            for session in sessions_elodie:
                inscription = Inscription(
                    participant_id=elodie.id,
                    session_id=session.id,
                    statut='confirmé',
                    validation_responsable=True
                )
                db.session.add(inscription)
            
            # Ajouter quelques activités initiales
            activites = [
                Activite(type='systeme', description='Initialisation de l\'application', details='Base de données créée avec succès'),
                Activite(type='systeme', description='Création des utilisateurs', details='Comptes administrateur et responsables créés'),
                Activite(type='inscription', description='Inscription d\'Élodie PHILIBERT', details='Sessions: diverses sessions de formation')
            ]
            db.session.add_all(activites)
            
            db.session.commit()

if __name__ == '__main__':
    init_db()
    socketio.run(app, debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))