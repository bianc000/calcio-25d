// Motore di Gioco 2.5D Calcio con Three.js
import { CHARACTERS, getCharacterById } from './characters.js?v=3.3';
import { sounds } from './audio.js?v=3.3';

export class FootballGame {
  constructor(canvasContainer, options = {}) {
    this.container = canvasContainer;
    this.options = options; // isHost, isOnline, networkManager, etc.

    // Dimensioni campo
    this.FIELD_W = 76; // asse X (da -38 a +38)
    this.FIELD_H = 46; // asse Z (da -23 a +23)
    this.GOAL_W = 12;  // larghezza porta
    this.GOAL_D = 4;   // profondità porta
    this.GOAL_H = 4.2; // altezza porta

    // Stato partita
    this.score = [0, 0];
    this.matchTime = 180; // 3 minuti in secondi (180s)
    this.state = 'waiting'; // waiting, playing, goal, ended
    this.goalCelebrationTimer = 0;
    this.isSinglePlayer = options.isSinglePlayer !== false;
    this.isPaused = false;
    this.controlMode = options.controlMode || '1v1'; // '1v1', '2v2', '3v3'
    this.localTeam = options.localTeam || (options.isClient ? 2 : 1);
    this.localSlot = (typeof options.localSlot === 'number') ? options.localSlot : 2;
    this.seats = options.seats || { t1: [null, null, null], t2: [null, null, null] };

    // Squadre (3 personaggi per squadra)
    this.team1Ids = options.team1 || ['ento', 'lindi', 'bubi'];
    this.team2Ids = options.team2 || ['pibe', 'matti', 'jelmo'];

    // Mario Strikers Super Gauge
    this.specialMeter1 = 50;
    this.specialMeter2 = 50;
    this.specialAudioPlayed1 = false;
    this.specialAudioPlayed2 = false;
    this.goalShieldTimer = 0;
    this.goalShieldTeam = 0;

    // Impatto visivo Camera Shake dinamico
    this.cameraShake = 0;
    this.isKeyboardActive = false;
    this.lastScoringTeam = 1;

    // Input locale e mappa input per più peer remoti (Host multi-giocatore)
    this.input = this._createInputState();
    this.remoteInput = this._createInputState();
    this.remoteInputs = new Map();
    this.humanControlMask = 0;

    // Lifecycle & sync networking state
    this.rafId = null;
    this.isDestroyed = false;
    this._netSyncAccum = 0;
    this._snapNextState = false;

    // Giocatore controllato attivamente in 1v1 (in 2v2/3v3 ogni umano comanda 1 slot fisso)
    this.activePlayerIdx1 = (this.controlMode !== '1v1' && this.localTeam === 1) ? this.localSlot : 2;
    this.activePlayerIdx2 = (this.controlMode !== '1v1' && this.localTeam === 2) ? this.localSlot : 2;

    // Setup Three.js
    this.initThree();
    this.createStadium();
    this.createBall();
    this.spawnPlayers();
    this.setupEventListeners();

    this.lastTime = performance.now();
    this.animate = this.animate.bind(this);
    this.rafId = requestAnimationFrame(this.animate);
  }

  initThree() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.scene = new window.THREE.Scene();
    this.scene.background = new window.THREE.Color(0x131e29);
    this.scene.fog = new window.THREE.FogExp2(0x131e29, 0.007);

    // Camera 2.5D Mario Strikers dinamica, cinematografica e ravvicinata
    this.camera = new window.THREE.PerspectiveCamera(46, width / height, 0.1, 1000);
    this.camera.position.set(0, 38, 46);
    this.camera.lookAt(0, 1.2, 0);

    // Renderer
    this.renderer = new window.THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = window.THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Luci
    const ambient = new window.THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambient);

    // Riflettori da stadio
    const floodlight1 = new window.THREE.DirectionalLight(0xfff5e6, 0.85);
    floodlight1.position.set(30, 50, 40);
    floodlight1.castShadow = true;
    floodlight1.shadow.mapSize.width = 2048;
    floodlight1.shadow.mapSize.height = 2048;
    floodlight1.shadow.camera.near = 10;
    floodlight1.shadow.camera.far = 120;
    floodlight1.shadow.camera.left = -45;
    floodlight1.shadow.camera.right = 45;
    floodlight1.shadow.camera.top = 35;
    floodlight1.shadow.camera.bottom = -35;
    this.scene.add(floodlight1);

    const floodlight2 = new window.THREE.DirectionalLight(0xaad5ff, 0.35);
    floodlight2.position.set(-30, 40, -40);
    this.scene.add(floodlight2);
  }

  createStadium() {
    // 1. Campo in erba con righe tagliate
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Strisce alternate verde chiaro e scuro
    const stripes = 12;
    const stripeW = canvas.width / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = (i % 2 === 0) ? '#2d7e35' : '#358c3d';
      ctx.fillRect(i * stripeW, 0, stripeW, canvas.height);
    }

    // Linee bianche del campo
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 14;

    const padX = 50;
    const padY = 50;
    const w = canvas.width - padX * 2;
    const h = canvas.height - padY * 2;

    // Perimetro
    ctx.strokeRect(padX, padY, w, h);

    // Linea di metà campo
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, padY);
    ctx.lineTo(canvas.width / 2, canvas.height - padY);
    ctx.stroke();

    // Cerchio di centrocampo
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 90, 0, Math.PI * 2);
    ctx.stroke();

    // Punto centrale
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 8, 0, Math.PI * 2);
    ctx.fill();

    // Aree di rigore (Sinistra e Destra)
    const boxW = 160;
    const boxH = 340;
    const boxY = (canvas.height - boxH) / 2;
    ctx.strokeRect(padX, boxY, boxW, boxH);
    ctx.strokeRect(canvas.width - padX - boxW, boxY, boxW, boxH);

    // Texture Three.js
    const pitchTexture = new window.THREE.CanvasTexture(canvas);
    pitchTexture.wrapS = window.THREE.ClampToEdgeWrapping;
    pitchTexture.wrapT = window.THREE.ClampToEdgeWrapping;

    const pitchGeo = new window.THREE.PlaneGeometry(this.FIELD_W, this.FIELD_H);
    const pitchMat = new window.THREE.MeshStandardMaterial({
      map: pitchTexture,
      roughness: 0.8,
      metalness: 0.1
    });
    this.pitch = new window.THREE.Mesh(pitchGeo, pitchMat);
    this.pitch.rotation.x = -Math.PI / 2;
    this.pitch.receiveShadow = true;
    this.scene.add(this.pitch);

    // Bordo esterno / Pista attorno al campo
    const outerGeo = new window.THREE.PlaneGeometry(this.FIELD_W + 16, this.FIELD_H + 14);
    const outerMat = new window.THREE.MeshStandardMaterial({ color: 0x194723, roughness: 0.9 });
    const outer = new window.THREE.Mesh(outerGeo, outerMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.scene.add(outer);

    // 2. Porte da Calcio (Pali bianchi e rete 3D)
    this.createGoal(-this.FIELD_W / 2, true);  // Porta sinistra (Team 1)
    this.createGoal(this.FIELD_W / 2, false);  // Porta destra (Team 2)

    // 3. Cartelloni pubblicitari a bordo campo
    this.createAdBoards();
  }

  createGoal(xPos, isLeft) {
    const goalGroup = new window.THREE.Group();
    const postMat = new window.THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.2 });

    const postRadius = 0.22;
    const postGeo = new window.THREE.CylinderGeometry(postRadius, postRadius, this.GOAL_H, 16);

    // Palo 1 (Z negativo)
    const post1 = new window.THREE.Mesh(postGeo, postMat);
    post1.position.set(0, this.GOAL_H / 2, -this.GOAL_W / 2);
    post1.castShadow = true;
    goalGroup.add(post1);

    // Palo 2 (Z positivo)
    const post2 = new window.THREE.Mesh(postGeo, postMat);
    post2.position.set(0, this.GOAL_H / 2, this.GOAL_W / 2);
    post2.castShadow = true;
    goalGroup.add(post2);

    // Traversa superiore
    const barGeo = new window.THREE.CylinderGeometry(postRadius, postRadius, this.GOAL_W, 16);
    const crossbar = new window.THREE.Mesh(barGeo, postMat);
    crossbar.rotation.x = Math.PI / 2;
    crossbar.position.set(0, this.GOAL_H, 0);
    crossbar.castShadow = true;
    goalGroup.add(crossbar);

    // Rete posteriore
    const dir = isLeft ? -1 : 1;
    const netMat = new window.THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      wireframe: true,
      transparent: true,
      opacity: 0.4
    });
    const netGeo = new window.THREE.BoxGeometry(this.GOAL_D, this.GOAL_H, this.GOAL_W);
    const net = new window.THREE.Mesh(netGeo, netMat);
    net.position.set(dir * (this.GOAL_D / 2), this.GOAL_H / 2, 0);
    goalGroup.add(net);

    goalGroup.position.set(xPos, 0, 0);
    this.scene.add(goalGroup);
  }

  createAdBoards() {
    const boardMat = new window.THREE.MeshStandardMaterial({ color: 0x0a1e36, roughness: 0.4 });
    const bannerMat = new window.THREE.MeshBasicMaterial({ color: 0x00e1d9 });

    // Bordo lungo superiore (Z negativo)
    const topBoard = new window.THREE.Mesh(new window.THREE.BoxGeometry(this.FIELD_W + 6, 1.2, 0.6), boardMat);
    topBoard.position.set(0, 0.6, -this.FIELD_H / 2 - 2);
    this.scene.add(topBoard);

    // Striscia LED luminosa
    const topLed = new window.THREE.Mesh(new window.THREE.BoxGeometry(this.FIELD_W + 5.5, 0.8, 0.65), bannerMat);
    topLed.position.set(0, 0.6, -this.FIELD_H / 2 - 2);
    this.scene.add(topLed);

    // Bordo lungo inferiore (Z positivo)
    const bottomBoard = new window.THREE.Mesh(new window.THREE.BoxGeometry(this.FIELD_W + 6, 1.2, 0.6), boardMat);
    bottomBoard.position.set(0, 0.6, this.FIELD_H / 2 + 2);
    this.scene.add(bottomBoard);
  }

  createBall() {
    const ballRadius = 0.7;
    const ballGeo = new window.THREE.SphereGeometry(ballRadius, 24, 24);

    // Creiamo una texture stile pallone classico a esagoni
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f7f7f7';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#1c1c1c';
    for (let x = 20; x < 256; x += 55) {
      for (let y = 15; y < 128; y += 45) {
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const ballTex = new window.THREE.CanvasTexture(canvas);
    const ballMat = new window.THREE.MeshStandardMaterial({
      map: ballTex,
      roughness: 0.35,
      metalness: 0.05
    });

    this.ballMesh = new window.THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    // Ombra del pallone a terra
    const shadowGeo = new window.THREE.CircleGeometry(ballRadius * 0.95, 16);
    const shadowMat = new window.THREE.MeshBasicMaterial({
      color: 0x07150a,
      transparent: true,
      opacity: 0.55
    });
    this.ballShadow = new window.THREE.Mesh(shadowGeo, shadowMat);
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.02;
    this.scene.add(this.ballShadow);

    // Scia di velocità e fiamme stile Mario Strikers (Ball Speed Trail)
    this.ballTrail = [];
    const trailGeo = new window.THREE.SphereGeometry(ballRadius * 0.72, 12, 12);
    for (let i = 0; i < 6; i++) {
      const trailMat = new window.THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0
      });
      const trailMesh = new window.THREE.Mesh(trailGeo, trailMat);
      trailMesh.visible = false;
      this.scene.add(trailMesh);
      this.ballTrail.push({ mesh: trailMesh, mat: trailMat });
    }

    // Dati fisici palla
    this.ball = {
      x: 0,
      y: ballRadius,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      spinZ: 0, // Effetto a rientrare / curva (Tiro a Giro)
      radius: ballRadius,
      rotX: 0,
      rotZ: 0,
      holder: null, // player in possesso
      lastPossessor: null,
      lastKicker: null,
      lastShooter: null,
      isSpecialShot: false,
      specialType: null,
      specialShooter: null
    };
  }

  // Aggiunge camera shake dinamico per dare impatto a tiri, spallate e gol
  addCameraShake(intensity) {
    this.cameraShake = Math.min(2.5, this.cameraShake + intensity);
  }

  createNameTag(charData, teamColor, isAra = false) {
    const name = (typeof charData === 'string') ? charData : (charData.name || '');
    const isAraChar = isAra || (typeof charData === 'object' && charData.id === 'ara') || (name.toUpperCase() === 'ARA');
    const icon = (typeof charData === 'object' && charData.specialIcon) ? charData.specialIcon : '';

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    // Sfondo badge a capsula arrotondata ad altissima visibilità e contrasto
    const x = 16, y = 16, w = 608, h = 128, r = 64;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(6, 12, 24, 0.96)';
    ctx.fill();

    const isTeam1 = (teamColor === 0xe74c3c);
    const borderColor = isAraChar ? '#ffd700' : (isTeam1 ? '#ff3355' : '#00e5ff');

    // Bordo con bagliore neon ultra-visibile
    ctx.lineWidth = 10;
    ctx.strokeStyle = borderColor;
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 18;
    ctx.stroke();

    // Pallino / gemma identificativa sulla sinistra
    ctx.beginPath();
    ctx.arc(68, 80, 24, 0, Math.PI * 2);
    ctx.fillStyle = borderColor;
    ctx.shadowBlur = 20;
    ctx.fill();

    // Nome del giocatore con ruolo e icona distintiva (compatto e pulito)
    let displayName = icon ? `${icon} ${name.toUpperCase()}` : name.toUpperCase();
    const charId = (typeof charData === 'object' && charData.id) ? charData.id : '';
    if (charId === 'ara' || isAraChar) displayName = '🦅 ARA';
    else if (charId === 'jona') displayName = '🦁 JONA (C)';
    else if (charId === 'bubi') displayName = '🛡️ BUBI (VC)';
    else if (charId === 'ento') displayName = '🟥 ENTO';
    else if (charId === 'lindi') displayName = '👑 LINDI';
    else if (charId === 'matti') displayName = '🧱 MATTI';
    else if (charId === 'jelmo') displayName = '⚡ JELMO';
    else if (charId === 'roby') displayName = '🦷 ROBY';
    else if (charId === 'lollo') displayName = '🍺 LOLLO';
    else if (charId === 'kri') displayName = '🐍 KRI';
    else if (charId === 'leon') displayName = '🦁 LEON';
    else if (charId === 'pibe') displayName = '🪄 PIBE';

    // Font grande, bold e nitido ad altissima visibilità
    let baseFontSize = 66;
    ctx.font = `900 ${baseFontSize}px "Rajdhani", "Arial Black", sans-serif`;
    let measuredWidth = ctx.measureText(displayName).width;
    if (measuredWidth > 460) {
      baseFontSize = Math.floor(baseFontSize * (460 / measuredWidth));
      ctx.font = `900 ${baseFontSize}px "Rajdhani", "Arial Black", sans-serif`;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = isAraChar ? '#ffd700' : '#ffffff';
    ctx.fillText(displayName, 350, 82);

    const texture = new window.THREE.CanvasTexture(canvas);
    texture.minFilter = window.THREE.LinearFilter;
    const spriteMat = new window.THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new window.THREE.Sprite(spriteMat);
    sprite.renderOrder = 999;
    return sprite;
  }

  createPlayerMesh(charData, teamColor, isCaptain = false) {
    const root = new window.THREE.Group();
    const scale = charData.height || 1.0;

    // 1. Torso Corazzato stile Mario Strikers (Ruby Red vs Electric Blue)
    const torsoGeo = new window.THREE.CylinderGeometry(0.64 * scale, 0.48 * scale, 1.15 * scale, 16);
    const torsoMat = new window.THREE.MeshStandardMaterial({
      color: teamColor,
      roughness: 0.35,
      metalness: 0.25
    });
    const torso = new window.THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.08 * scale;
    torso.castShadow = true;
    root.add(torso);

    // Spallacci corazzati stile Mario Strikers (Spalle larghe, atletiche e protette)
    const shoulderMat = new window.THREE.MeshStandardMaterial({
      color: (isCaptain || charData.id === 'jona' || charData.id === 'bubi') ? 0xffdd00 : teamColor,
      roughness: 0.2,
      metalness: 0.6
    });
    const leftPad = new window.THREE.Mesh(new window.THREE.BoxGeometry(0.38 * scale, 0.24 * scale, 0.46 * scale), shoulderMat);
    leftPad.position.set(-0.62 * scale, 1.45 * scale, 0);
    leftPad.rotation.z = 0.25;
    root.add(leftPad);

    const rightPad = new window.THREE.Mesh(new window.THREE.BoxGeometry(0.38 * scale, 0.24 * scale, 0.46 * scale), shoulderMat);
    rightPad.position.set(0.62 * scale, 1.45 * scale, 0);
    rightPad.rotation.z = -0.25;
    root.add(rightPad);

    // Dettaglio personalizzato: Mantello per Leon, Cartellino per Ento
    if (charData.id === 'leon') {
      const capeGeo = new window.THREE.PlaneGeometry(0.85 * scale, 1.1 * scale);
      const capeMat = new window.THREE.MeshStandardMaterial({ color: 0x111118, side: window.THREE.DoubleSide });
      const cape = new window.THREE.Mesh(capeGeo, capeMat);
      cape.position.set(0, 0.95 * scale, -0.42 * scale);
      cape.rotation.x = 0.2;
      root.add(cape);
    } else if (charData.id === 'ento') {
      const cardGeo = new window.THREE.PlaneGeometry(0.22 * scale, 0.32 * scale);
      const cardMat = new window.THREE.MeshBasicMaterial({ color: 0xff0033 });
      const card = new window.THREE.Mesh(cardGeo, cardMat);
      card.position.set(0.18 * scale, 1.25 * scale, 0.52 * scale);
      root.add(card);
    }

    // Pantaloncini atletici
    const shortsGeo = new window.THREE.CylinderGeometry(0.50 * scale, 0.44 * scale, 0.42 * scale, 16);
    const shortsMat = new window.THREE.MeshStandardMaterial({ color: 0x111625, roughness: 0.5 });
    const shorts = new window.THREE.Mesh(shortsGeo, shortsMat);
    shorts.position.y = 0.58 * scale;
    shorts.castShadow = true;
    root.add(shorts);

    // Gambe & Scarpini con tacchetti (Mario Strikers Cleats)
    const bootMat = new window.THREE.MeshStandardMaterial({ color: 0x050810, roughness: 0.3, metalness: 0.4 });
    const sockMat = new window.THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.5 });

    [-0.24 * scale, 0.24 * scale].forEach(legX => {
      const sock = new window.THREE.Mesh(new window.THREE.CylinderGeometry(0.14 * scale, 0.12 * scale, 0.42 * scale, 10), sockMat);
      sock.position.set(legX, 0.28 * scale, 0);
      root.add(sock);

      const boot = new window.THREE.Mesh(new window.THREE.BoxGeometry(0.24 * scale, 0.16 * scale, 0.42 * scale), bootMat);
      boot.position.set(legX, 0.08 * scale, 0.08 * scale);
      root.add(boot);
    });

    // Supporto atletico del collo
    const neckGeo = new window.THREE.CylinderGeometry(0.24 * scale, 0.28 * scale, 0.35 * scale, 12);
    const neckMat = new window.THREE.MeshStandardMaterial({ color: 0x1e272e, roughness: 0.6 });
    const neck = new window.THREE.Mesh(neckGeo, neckMat);
    neck.position.y = 1.65 * scale;
    root.add(neck);

    // 2. VERO VOLTO FOTOGRAFICO IN-GAME (Stile Mario Strikers / Bobblehead)
    // Mostra la reale foto dell'amico sempre rivolta alla telecamera con grandissima definizione
    const loader = new window.THREE.TextureLoader();
    const avatarPath = charData.avatar || `assets/${charData.id}_avatar.png?v=3.3`;
    const faceTex = loader.load(avatarPath);
    const faceMat = new window.THREE.SpriteMaterial({
      map: faceTex,
      transparent: true,
      depthTest: false // Sempre in primo piano e visibile al 100%
    });
    const faceSprite = new window.THREE.Sprite(faceMat);
    faceSprite.position.set(0, 2.38 * scale, 0);
    faceSprite.scale.set(2.45 * scale, 2.45 * scale, 1);
    faceSprite.renderOrder = 950;
    root.add(faceSprite);

    // Fascia Capitano (Jona) o Vice Capitano (Bubi) al braccio
    const isCap = isCaptain || charData.id === 'jona';
    const isViceCap = charData.id === 'bubi';
    if (isCap || isViceCap) {
      const armBandGeo = new window.THREE.CylinderGeometry(0.16 * scale, 0.16 * scale, 0.14 * scale, 12);
      const armBandMat = new window.THREE.MeshBasicMaterial({ color: isCap ? 0xffdd00 : 0x00e5ff });
      const armBand = new window.THREE.Mesh(armBandGeo, armBandMat);
      armBand.position.set(-0.70 * scale, 1.25 * scale, 0);
      root.add(armBand);
    }

    // 4. Ombra a terra del giocatore
    const shadowGeo = new window.THREE.CircleGeometry(0.85 * scale, 16);
    const shadowMat = new window.THREE.MeshBasicMaterial({ color: 0x051206, transparent: true, opacity: 0.5 });
    const shadow = new window.THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    root.add(shadow);

    // 5. Anello di selezione luminoso sotto i piedi
    const ringGeo = new window.THREE.RingGeometry(0.95 * scale, 1.25 * scale, 32);
    const ringMat = new window.THREE.MeshBasicMaterial({
      color: 0xffee00,
      side: window.THREE.DoubleSide,
      transparent: true,
      opacity: 0
    });
    const ring = new window.THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    root.add(ring);

    // 6. Freccia direzionale
    const arrowGeo = new window.THREE.ConeGeometry(0.35 * scale, 0.7 * scale, 3);
    const arrowMat = new window.THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const arrow = new window.THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.05, 1.6 * scale);
    root.add(arrow);

    // 7. Cartellino nome giocatore in 3D fluttuante sopra la testa (proporzionato, nitido ed elegante)
    const nameTag = this.createNameTag(charData, teamColor, charData.id === 'ara');
    nameTag.position.set(0, 3.85 * scale, 0);
    nameTag.scale.set(3.2 * scale, 0.8 * scale, 1);
    root.add(nameTag);

    return { root, ring, ringMat, arrow, arrowMat, nameTag, scale };
  }

  spawnPlayers() {
    this.playersTeam1 = [];
    this.playersTeam2 = [];

    // Colori maglie: Squadra 1 (Rosso Rubino), Squadra 2 (Azzurro / Blu Elettrico)
    const colorTeam1 = 0xe74c3c;
    const colorTeam2 = 0x2980b9;

    // Posizioni base 3v3 (Portiere/Difensore, Mediano, Attaccante)
    const posTeam1 = [
      { x: -26, z: 0, role: 'gk' },
      { x: -14, z: -8, role: 'mid' },
      { x: -6, z: 7, role: 'att' }
    ];

    const posTeam2 = [
      { x: 26, z: 0, role: 'gk' },
      { x: 14, z: 8, role: 'mid' },
      { x: 6, z: -7, role: 'att' }
    ];

    // Crea Squadra 1
    this.team1Ids.forEach((id, idx) => {
      const charData = getCharacterById(id);
      const meshData = this.createPlayerMesh(charData, colorTeam1, idx === 0);
      const p = {
        id,
        name: charData.name,
        charData,
        team: 1,
        index: idx,
        role: posTeam1[idx].role,
        mesh: meshData.root,
        nameTag: meshData.nameTag,
        ringMat: meshData.ringMat,
        arrowMat: meshData.arrowMat,
        x: posTeam1[idx].x,
        z: posTeam1[idx].z,
        vx: 0,
        vz: 0,
        rot: 0,
        baseX: posTeam1[idx].x,
        baseZ: posTeam1[idx].z,
        scale: meshData.scale,
        isSliding: false,
        slideTimer: 0,
        stamina: 100,
        kickAnim: 0,
        protectionTimer: 0,
        tackleCooldown: 0,
        possessionTime: 0,
        cannotPickupTimer: 0,
        isExpelled: false,
        expelledTimer: 0
      };
      meshData.root.position.set(p.x, 0, p.z);
      this.scene.add(meshData.root);
      this.playersTeam1.push(p);
    });

    // Crea Squadra 2
    this.team2Ids.forEach((id, idx) => {
      const charData = getCharacterById(id);
      const meshData = this.createPlayerMesh(charData, colorTeam2, idx === 0);
      const p = {
        id,
        name: charData.name,
        charData,
        team: 2,
        index: idx,
        role: posTeam2[idx].role,
        mesh: meshData.root,
        nameTag: meshData.nameTag,
        ringMat: meshData.ringMat,
        arrowMat: meshData.arrowMat,
        x: posTeam2[idx].x,
        z: posTeam2[idx].z,
        vx: 0,
        vz: 0,
        rot: Math.PI,
        baseX: posTeam2[idx].x,
        baseZ: posTeam2[idx].z,
        scale: meshData.scale,
        isSliding: false,
        slideTimer: 0,
        stamina: 100,
        kickAnim: 0,
        protectionTimer: 0,
        tackleCooldown: 0,
        possessionTime: 0,
        cannotPickupTimer: 0,
        isExpelled: false,
        expelledTimer: 0
      };
      meshData.root.position.set(p.x, 0, p.z);
      meshData.root.rotation.y = Math.PI;
      this.scene.add(meshData.root);
      this.playersTeam2.push(p);
    });

    this.allPlayers = [...this.playersTeam1, ...this.playersTeam2];
  }

  _createInputState() {
    return {
      moveX: 0,
      moveZ: 0,
      sprint: false,
      isChargingShot: false,
      shotPower: 0,
      shootTrigger: false,
      shotBufferTimer: 0,
      passTrigger: false,
      passBufferTimer: 0,
      slideTrigger: false,
      switchTrigger: false
    };
  }

  _getSeatController(team, slot) {
    if (this.controlMode === '1v1') {
      if (team === 1) return (slot === this.activePlayerIdx1) ? 'host' : null;
      if (this.isSinglePlayer) return null;
      if (slot === this.activePlayerIdx2) return this.seats.t2Peer || 'guest';
      return null;
    }
    if (this.controlMode === '2v2' && slot === 0) {
      return null; // Portiere sempre CPU in 2v2
    }
    const list = (team === 1) ? this.seats.t1 : this.seats.t2;
    return (Array.isArray(list) && list[slot]) ? list[slot] : null;
  }

  _findPeerSeat(peerId) {
    if (this.controlMode === '1v1') {
      return { team: 2, slot: this.activePlayerIdx2 };
    }
    for (let s = 0; s < 3; s++) {
      if (this.controlMode === '2v2' && s === 0) continue;
      if (this.seats.t1 && this.seats.t1[s] === peerId) return { team: 1, slot: s };
      if (this.seats.t2 && this.seats.t2[s] === peerId) return { team: 2, slot: s };
    }
    return null;
  }

  _isSlotHumanControlled(team, slot) {
    if (this.options.isClient) {
      const bit = (team === 1 ? 0 : 3) + slot;
      return (this.humanControlMask & (1 << bit)) !== 0;
    }
    return Boolean(this._getSeatController(team, slot));
  }

  _getLocalControlledPlayer() {
    const arr = (this.localTeam === 1) ? this.playersTeam1 : this.playersTeam2;
    const idx = (this.controlMode === '1v1')
      ? (this.localTeam === 1 ? this.activePlayerIdx1 : this.activePlayerIdx2)
      : this.localSlot;
    return arr[idx] || arr[2] || arr[0];
  }

  _getPrimaryHumanOnTeam(team, refPlayer = null) {
    const arr = (team === 1) ? this.playersTeam1 : this.playersTeam2;
    if (this.controlMode === '1v1') {
      if (team === 1) return arr[this.activePlayerIdx1];
      return (!this.isSinglePlayer || this.options.isClient) ? arr[this.activePlayerIdx2] : null;
    }
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < arr.length; i++) {
      if (!this._isSlotHumanControlled(team, i)) continue;
      const candidate = arr[i];
      if (!refPlayer) return candidate;
      const d = Math.hypot(candidate.x - refPlayer.x, candidate.z - refPlayer.z);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    return best;
  }

  _requestCpuTeammatePass(team, requesterSlot) {
    const holder = this.ball.holder;
    if (!holder || holder.team !== team) return;
    if (this._isSlotHumanControlled(team, holder.index)) return; // Non interrompere un compagno umano
    const arr = (team === 1) ? this.playersTeam1 : this.playersTeam2;
    const target = arr[requesterSlot];
    if (target && !target.isExpelled && target !== holder) {
      holder._forcedPassTarget = target;
    }
  }

  // Verifica se la squadra dell'utente ha il possesso del pallone
  userTeamHasBall() {
    return Boolean(this.ball.holder && this.ball.holder.team === this.localTeam);
  }

  // In 1v1 vale il possesso squadra; in 2v2/3v3 vale il possesso personale del giocatore bloccato
  localPlayerHasBall() {
    if (this.controlMode === '1v1') return this.userTeamHasBall();
    const me = this._getLocalControlledPlayer();
    return Boolean(me && this.ball.holder === me);
  }

  emitClientAction(actionPayload) {
    if (this.options.isClient && this.options.onClientAction) {
      this.options.onClientAction(actionPayload);
    }
  }

  triggerInputPass() {
    if (this.controlMode !== '1v1' && !this.localPlayerHasBall()) {
      if (this.userTeamHasBall()) {
        if (this.options.isClient) {
          this.emitClientAction({ action: 'call_pass' });
        } else {
          this._requestCpuTeammatePass(this.localTeam, this.localSlot);
        }
      }
      return;
    }
    if (this.options.isClient) {
      this.emitClientAction({ action: 'pass' });
      return;
    }
    this.input.passTrigger = true;
    this.input.passBufferTimer = 0.5;
  }

  triggerInputSwitch() {
    if (this.controlMode !== '1v1') {
      // In 2v2 / 3v3 il giocatore resta fisso sul proprio ruolo
      return;
    }
    if (this.options.isClient) {
      this.emitClientAction({ action: 'switch' });
      return;
    }
    this.switchActivePlayer(1);
  }

  triggerInputSlide() {
    if (this.options.isClient) {
      this.emitClientAction({ action: 'slide' });
      return;
    }
    this.input.slideTrigger = true;
  }

  startInputShotCharge() {
    if (this.localPlayerHasBall()) {
      this.input.isChargingShot = true;
      this.input.shotPower = Math.max(this.input.shotPower, 0.45);
      if (this.options.isClient) {
        this.emitClientAction({ action: 'charge_start', shotPower: this.input.shotPower });
      }
    } else {
      this.triggerInputSlide();
    }
  }

  releaseInputShot() {
    if (!this.input.isChargingShot) return;
    this.input.isChargingShot = false;
    if (this.options.isClient) {
      const power = Math.max(0.45, this.input.shotPower || 0.45);
      this.emitClientAction({ action: 'shoot', shotPower: power });
      this.input.shotPower = 0;
      return;
    }
    this.input.shootTrigger = true;
    this.input.shotBufferTimer = 0.5;
  }

  triggerInputSpecial() {
    if (this.options.isClient) {
      this.emitClientAction({ action: 'special' });
      return;
    }
    const overrideIdx = (this.controlMode === '1v1') ? null : this.localSlot;
    this.triggerSpecial(this.localTeam, overrideIdx);
  }

  setupEventListeners() {
    // Gestione tastiera
    this.keysDown = {};

    const isTextField = (target) => (
      target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    );

    this._onKeyDown = (e) => {
      if (isTextField(e.target)) return;
      this.keysDown[e.code] = true;
      this.isKeyboardActive = true;

      // Pausa (Escape o P)
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.options.onTogglePause) {
          this.options.onTogglePause();
          e.preventDefault();
          return;
        }
      }

      // Mario Strikers Super Move (E, F, R)
      if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'KeyR') {
        this.triggerInputSpecial();
        e.preventDefault();
        return;
      }

      // Tasti di Passaggio secondari: Z, J, B
      if (e.code === 'KeyZ' || e.code === 'KeyJ' || e.code === 'KeyB') {
        this.triggerInputPass();
        e.preventDefault();
        return;
      }

      // SPAZIO:
      // In possesso palla -> PASSA al compagno migliore!
      // Senza palla / in difesa -> CAMBIA GIOCATORE ATTIVO al più vicino al pallone!
      if (e.code === 'Space') {
        if (this.userTeamHasBall()) {
          this.triggerInputPass();
        } else {
          this.triggerInputSwitch();
        }
        e.preventDefault();
        return;
      }

      // Q: sempre cambio giocatore manuale
      if (e.code === 'KeyQ') {
        this.triggerInputSwitch();
        e.preventDefault();
        return;
      }

      // INVIO (Enter, NumpadEnter) o tasti secondari (KeyX, KeyK, KeyC, KeyV):
      // In possesso palla -> TIRO (carica tenendo premuto, calcia al rilascio)!
      // Senza palla / in difesa -> SCIVOLATA / CONTRASTO FISICO (Mario Strikers Body Check)!
      const isShootKey = (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyX' || e.code === 'KeyK' || e.code === 'KeyC' || e.code === 'KeyV');
      if (isShootKey) {
        if (!e.repeat) {
          this.startInputShotCharge();
        }
        e.preventDefault();
        return;
      }
    };

    this._onKeyUp = (e) => {
      if (isTextField(e.target)) return;
      this.keysDown[e.code] = false;

      const isShootKey = (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyX' || e.code === 'KeyK' || e.code === 'KeyC' || e.code === 'KeyV');

      // Rilascio del tasto di tiro: scaglia il tiro in porta!
      if (isShootKey && this.input.isChargingShot) {
        this.releaseInputShot();
      }
    };

    // Supporto Click del Mouse solo su desktop se si clicca direttamente sul Canvas di gioco
    this._onMouseDown = (e) => {
      // Ignora completamente eventi touch emulati e click su comandi touch/UI
      if (e.pointerType === 'touch' || e.target.closest('#in-game-touch-controls') || e.target.closest('.interactive') || e.target.tagName !== 'CANVAS') return;
      this.startInputShotCharge();
    };

    this._onMouseUp = (e) => {
      if (e.pointerType === 'touch' || e.target.closest('#in-game-touch-controls') || e.target.closest('.interactive')) return;
      if (this.input.isChargingShot) {
        this.releaseInputShot();
      }
    };

    this._onBlur = () => {
      this.keysDown = {};
      if (this.input.isChargingShot) {
        this.releaseInputShot();
      }
    };

    // Resize finestra
    this._onResize = () => {
      if (!this.container || !this.renderer || !this.camera) return;
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('resize', this._onResize);
  }

  destroy() {
    this.isDestroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener('keyup', this._onKeyUp);
    if (this._onMouseDown) window.removeEventListener('mousedown', this._onMouseDown);
    if (this._onMouseUp) window.removeEventListener('mouseup', this._onMouseUp);
    if (this._onBlur) window.removeEventListener('blur', this._onBlur);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.renderer) {
      try {
        if (this.renderer.domElement && this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        this.renderer.dispose();
      } catch (e) {
        console.warn('[Game] Errore cleanup renderer:', e);
      }
    }
  }

  _getRemoteInputState(peerId = 'guest') {
    if (this.controlMode === '1v1' || peerId === 'guest') return this.remoteInput;
    if (!this.remoteInputs.has(peerId)) {
      this.remoteInputs.set(peerId, this._createInputState());
    }
    return this.remoteInputs.get(peerId);
  }

  releasePeer(peerId) {
    if (!peerId) return;
    this.remoteInputs.delete(peerId);
    if (this.seats.t2Peer === peerId) this.seats.t2Peer = null;
    ['t1', 't2'].forEach(key => {
      if (Array.isArray(this.seats[key])) {
        this.seats[key] = this.seats[key].map(v => (v === peerId ? null : v));
      }
    });
  }

  // Riceve movimento continuo dal giocatore remoto (Host multi-peer)
  setRemoteInput(inputData, peerId = 'guest') {
    if (!inputData) return;
    const target = (this.controlMode === '1v1')
      ? this.remoteInput
      : this._getRemoteInputState(peerId);
    if (typeof inputData.moveX === 'number') target.moveX = inputData.moveX;
    if (typeof inputData.moveZ === 'number') target.moveZ = inputData.moveZ;
    if (typeof inputData.sprint === 'boolean') target.sprint = inputData.sprint;
  }

  // Riceve azioni discrete istantanee dai Client (Host multi-peer)
  handleRemoteAction(data, peerId = 'guest') {
    if (!data || !this.options.isHost) return;
    const seat = this._findPeerSeat(peerId);
    if (!seat) return;
    const inp = (this.controlMode === '1v1')
      ? this.remoteInput
      : this._getRemoteInputState(peerId);

    switch (data.action) {
      case 'pass':
        inp.passTrigger = true;
        inp.passBufferTimer = 0.5;
        break;
      case 'call_pass':
        if (this.state === 'playing') {
          this._requestCpuTeammatePass(seat.team, seat.slot);
        }
        break;
      case 'switch':
        if (this.controlMode === '1v1' && this.state === 'playing') {
          this.switchActivePlayer(seat.team);
        }
        break;
      case 'slide':
        inp.slideTrigger = true;
        break;
      case 'charge_start':
        inp.isChargingShot = true;
        inp.shotPower = Math.max(inp.shotPower || 0, Number(data.shotPower) || 0.45);
        break;
      case 'shoot':
        inp.isChargingShot = false;
        inp.shotPower = Math.max(0.45, Math.min(1.0, Number(data.shotPower) || 0.55));
        inp.shootTrigger = true;
        inp.shotBufferTimer = 0.5;
        break;
      case 'special':
        if (this.state === 'playing') {
          const overrideIdx = (this.controlMode === '1v1') ? null : seat.slot;
          this.triggerSpecial(seat.team, overrideIdx);
        }
        break;
    }
  }

  // Resetta palla e giocatori al centro (Kickoff)
  resetKickoff(concedingTeam = 1) {
    this.ball.x = 0;
    this.ball.y = this.ball.radius;
    this.ball.z = 0;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
    this.ball.spinZ = 0;
    this.ball.holder = null;
    this.ball.lastPossessor = null;
    this.ball.lastKicker = null;
    this.ball.lastShooter = null;
    this.ball.isSpecialShot = false;
    this.ball.specialType = null;
    this.ball.specialShooter = null;

    // Rimetti i giocatori nelle rispettive metà campo
    this.playersTeam1.forEach(p => {
      p.x = p.baseX;
      p.z = p.baseZ;
      p.vx = 0;
      p.vz = 0;
      p.isSliding = false;
      p.isExpelled = false;
      p.expelledTimer = 0;
      p.mesh.position.set(p.x, 0, p.z);
    });

    this.playersTeam2.forEach(p => {
      p.x = p.baseX;
      p.z = p.baseZ;
      p.vx = 0;
      p.vz = 0;
      p.isSliding = false;
      p.isExpelled = false;
      p.expelledTimer = 0;
      p.mesh.position.set(p.x, 0, p.z);
    });

    // Chi batte riceve la palla vicino e viene selezionato come giocatore attivo (in 1v1)
    if (concedingTeam === 1) {
      // Batte Team 1
      const striker = this.playersTeam1[2];
      striker.x = -1.2;
      striker.z = 0;
      striker.possessionTime = 0;
      striker.protectionTimer = 0.6;
      striker.cannotPickupTimer = 0;
      this.ball.holder = striker;
      this.ball.x = -0.3;
      this.ball.z = 0;
      if (this.controlMode === '1v1') this.activePlayerIdx1 = 2; // Controllo immediato sull'attaccante che batte al centro!
    } else {
      // Batte Team 2
      const striker = this.playersTeam2[2];
      striker.x = 1.2;
      striker.z = 0;
      striker.possessionTime = 0;
      striker.protectionTimer = 0.6;
      striker.cannotPickupTimer = 0;
      this.ball.holder = striker;
      this.ball.x = 0.3;
      this.ball.z = 0;
      if (this.controlMode === '1v1') this.activePlayerIdx2 = 2; // Controllo immediato sull'attaccante che batte al centro!
    }

    this.ballMesh.position.set(this.ball.x, this.ball.y, this.ball.z);
    this.ballShadow.position.set(this.ball.x, 0.02, this.ball.z);

    this.state = 'playing';
    sounds.playWhistle(false);
    this.emitGameEvent({ event: 'kickoff', concedingTeam });
  }

  // Gestione Pausa
  togglePause() {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  setPause(paused) {
    this.isPaused = paused;
  }

  // Switch al compagno più vicino alla palla (solo in 1v1, escludendo il giocatore già attivo e quelli espulsi)
  switchActivePlayer(teamNum) {
    if (this.controlMode !== '1v1') return;
    const team = (teamNum === 1) ? this.playersTeam1 : this.playersTeam2;
    const currentIdx = (teamNum === 1) ? this.activePlayerIdx1 : this.activePlayerIdx2;
    let closestIdx = -1;
    let minDist = 99999;

    team.forEach((p, idx) => {
      if (idx === currentIdx || p.isExpelled) return;
      const dx = p.x - this.ball.x;
      const dz = p.z - this.ball.z;
      const dist = Math.hypot(dx, dz);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    });

    if (closestIdx !== -1) {
      if (teamNum === 1) {
        this.activePlayerIdx1 = closestIdx;
      } else {
        this.activePlayerIdx2 = closestIdx;
      }
      sounds.playBeep(750, 0.05);
    }
  }

  // Aggiorna input da tastiera
  processInput(dt) {
    let mx = 0;
    let mz = 0;

    if (this.keysDown['ArrowLeft'] || this.keysDown['KeyA']) mx -= 1;
    if (this.keysDown['ArrowRight'] || this.keysDown['KeyD']) mx += 1;
    if (this.keysDown['ArrowUp'] || this.keysDown['KeyW']) mz -= 1;
    if (this.keysDown['ArrowDown'] || this.keysDown['KeyS']) mz += 1;

    // Normalizza direzione da tastiera senza cancellare l'input del joystick mobile touch!
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      this.input.moveX = mx / len;
      this.input.moveZ = mz / len;
    } else if (this.isKeyboardActive) {
      this.input.moveX = 0;
      this.input.moveZ = 0;
    }

    if (this.keysDown['ShiftLeft'] || this.keysDown['ShiftRight']) {
      this.input.sprint = true;
    } else if (this.isKeyboardActive) {
      this.input.sprint = false;
    }

    // Decrementa finestra buffer tiro e passaggio per non perdere mai i comandi su mobile
    this._tickInputBuffers(this.input, dt);
    if (this.options.isHost && !this.isSinglePlayer) {
      this._tickInputBuffers(this.remoteInput, dt);
      this.remoteInputs.forEach(inp => this._tickInputBuffers(inp, dt));
    }
  }

  _tickInputBuffers(inp, dt) {
    if (inp.shotBufferTimer > 0) {
      inp.shotBufferTimer -= dt;
    }
    if (inp.passBufferTimer > 0) {
      inp.passBufferTimer -= dt;
    }

    // Caricamento tiro (tenendo premuto aumenta, ma un tocco rapido ha già potenza minima)
    if (inp.isChargingShot) {
      inp.shotPower = Math.min(1.0, inp.shotPower + dt * 1.5);
    } else if (!inp.shootTrigger && (!inp.shotBufferTimer || inp.shotBufferTimer <= 0)) {
      inp.shotPower = 0;
    }
  }

  _autoSwitchToPlayer(team, idx) {
    if (this.controlMode !== '1v1') return;
    if (team === 1 && !this.options.isClient) {
      this.activePlayerIdx1 = idx;
    } else if (team === 2 && (this.options.isClient || !this.isSinglePlayer)) {
      this.activePlayerIdx2 = idx;
    }
  }

  emitGameEvent(payload) {
    if (this.options.isHost && this.options.onGameEvent) {
      this.options.onGameEvent(payload);
    }
  }

  applyNetworkEvent(data) {
    if (!data || !this.options.isClient) return;
    switch (data.event) {
      case 'kickoff':
        this._snapNextState = true;
        this.state = 'playing';
        sounds.playWhistle(false);
        break;
      case 'toast':
        if (data.text && this.options.onToast) {
          this.options.onToast(data.text);
        }
        if (data.text && data.text.includes('CARTELLINO ROSSO')) {
          sounds.playRedCardWhistle();
          this.addCameraShake(0.85);
        } else if (data.text && data.text.includes('RIENTRA')) {
          sounds.playWhistle(false);
        }
        break;
      case 'special': {
        const teamArr = (data.team === 1) ? this.playersTeam1 : this.playersTeam2;
        const player = teamArr[data.playerIndex] || teamArr[0];
        const char = player ? player.charData : null;
        if (data.specialType) sounds.playSpecialStrike(data.specialType);
        if (data.charId === 'ara') sounds.playEagleCry();
        else if (data.charId === 'lollo') sounds.playBeerShot();
        else if (data.charId === 'ento') sounds.playRedCardWhistle();
        if (this.options.onSpecialTrigger && player && char) {
          this.options.onSpecialTrigger({ player, charData: char });
        }
        break;
      }
      case 'goal': {
        this.score = data.score || this.score;
        this.lastScoringTeam = data.scoringTeam;
        this.state = 'goal';
        sounds.playGoalCheer();
        this.addCameraShake(1.3);
        const att = (data.scoringTeam === 1) ? this.playersTeam1 : this.playersTeam2;
        const scorer = att.find(p => p.charData && p.charData.id === data.scorerId) || att[0];
        if (this.options.onGoal) {
          this.options.onGoal(data.scoringTeam, this.score, scorer, !!data.isSpecialGoal);
        }
        break;
      }
      case 'match_end':
        this.score = data.score || this.score;
        this.state = 'ended';
        sounds.playWhistle(true);
        if (this.options.onMatchEnd) {
          this.options.onMatchEnd(this.score);
        }
        break;
    }
  }

  // Aggiorna stato di un giocatore
  updatePlayer(p, inputData, dt) {
    // Se espulso con Cartellino Rosso dello Sbirro Arbitro: resta a bordo campo
    if (p.isExpelled) {
      p.expelledTimer -= dt;
      p.x = (p.team === 1 ? -12 : 12);
      p.z = (this.FIELD_H / 2) + 4.5;
      p.vx = 0;
      p.vz = 0;
      p.mesh.position.set(p.x, 0, p.z);
      if (p.expelledTimer <= 0) {
        p.isExpelled = false;
        p.x = p.baseX;
        p.z = p.baseZ;
        p.mesh.position.set(p.x, 0, p.z);
        sounds.playWhistle(false);
        const msg = `⏱️ ${p.name.toUpperCase()} RIENTRA DALL'ESPULSIONE!`;
        if (this.options.onToast) this.options.onToast(msg);
        this.emitGameEvent({ event: 'toast', text: msg });
      }
      return;
    }

    const stats = p.charData;
    const isHuman = this._isSlotHumanControlled(p.team, p.index);

    if (p.protectionTimer > 0) p.protectionTimer -= dt;
    if (p.tackleCooldown > 0) p.tackleCooldown -= dt;
    if (p.cannotPickupTimer > 0) p.cannotPickupTimer -= dt;

    const baseSpeed = 8.8 + (stats.speed / 100) * 3.6; // Velocità calibrata e controllabile (8.8 - 12.4 unità/sec)
    const speedMult = inputData.sprint ? (isHuman ? 1.35 : 1.25) : 1.0;
    const currentMaxSpeed = baseSpeed * speedMult;

    // Gestione scivolata difensiva
    if (p.isSliding) {
      p.slideTimer -= dt;
      p.vx *= 0.94;
      p.vz *= 0.94;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.rotation.x = Math.PI / 3; // inclinato a terra

      // Controlla se colpisce la palla o l'avversario durante la scivolata
      const distBall = Math.hypot(p.x - this.ball.x, p.z - this.ball.z);
      if (distBall < 2.4 * p.scale && this.ball.holder !== p) {
        const holder = this.ball.holder;
        if (!holder || holder.protectionTimer <= 0) {
          this.ball.holder = null;
          this.ball.lastKicker = p;
          this.chargeMeter(p.team, 15);
          p.cannotPickupTimer = 0.2;
          const kickDirX = Math.sin(p.rot);
          const kickDirZ = Math.cos(p.rot);
          const tacklePwr = 17 + (stats.tackle / 100) * 8;
          this.ball.vx = kickDirX * tacklePwr;
          this.ball.vz = kickDirZ * tacklePwr;
          this.ball.vy = 2.4;
          if (holder) {
            holder.protectionTimer = 0;
            holder.tackleCooldown = 0.6;
          }
          sounds.playSlide();
        }
      }

      if (p.slideTimer <= 0) {
        p.isSliding = false;
        p.mesh.rotation.x = 0;
      }
      return;
    }

    // Trigger contrasto: Tuffo del Portiere Umano, Spallata fisica da vicino o Scivolata in corsa
    if (inputData.slideTrigger && !p.isSliding) {
      const distToBallNow = Math.hypot(this.ball.x - p.x, this.ball.z - p.z);
      if (isHuman && p.role === 'gk' && !this.ball.holder && distToBallNow < 4.2 * p.scale) {
        sounds.playGloveSave();
        this.addCameraShake(0.5);
        p.isSliding = true;
        p.slideTimer = 0.42;
        const dx = this.ball.x - p.x;
        const dz = this.ball.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        const diveSpeed = currentMaxSpeed * 1.65;
        p.vx = (dx / d) * diveSpeed;
        p.vz = (dz / d) * diveSpeed;
        p.rot = Math.atan2(dx, dz);

        const movingToOwnGoal = (p.team === 1) ? (this.ball.vx < -14) : (this.ball.vx > 14);
        if (distToBallNow < 2.6 * p.scale && movingToOwnGoal) {
          const outDir = (p.team === 1) ? 1 : -1;
          this.ball.vx = outDir * 14;
          this.ball.vz = Math.sign(this.ball.z - p.z || 1) * 9 + (Math.random() - 0.5) * 5;
          this.ball.vy = 2.6;
          this.ball.isSpecialShot = false;
          p.cannotPickupTimer = 0.3;
        }
        inputData.slideTrigger = false;
        return;
      }

      const enemyCarrier = (this.ball.holder && this.ball.holder.team !== p.team) ? this.ball.holder : null;
      const distToCarrier = enemyCarrier ? Math.hypot(p.x - enemyCarrier.x, p.z - enemyCarrier.z) : 999;

      if (enemyCarrier && distToCarrier < 2.2 * p.scale && p.tackleCooldown <= 0) {
        // SPALLATA FISICA / BODY CHECK DEVASTANTE!
        sounds.playBodyCheck();
        this.addCameraShake(0.85);

        enemyCarrier.protectionTimer = 0;
        enemyCarrier.cannotPickupTimer = 0.65;
        enemyCarrier.possessionTime = 0;
        enemyCarrier.tackleCooldown = 0.8;
        this.ball.holder = null;
        this.ball.lastKicker = p;
        this.chargeMeter(p.team, 16);

        const shoveDirX = Math.sign(enemyCarrier.x - p.x || (p.team === 1 ? 1 : -1));
        const shoveDirZ = Math.sign(enemyCarrier.z - p.z || 1);
        enemyCarrier.vx = shoveDirX * 13;
        enemyCarrier.vz = shoveDirZ * 7;
        enemyCarrier.isSliding = true;
        enemyCarrier.slideTimer = 0.55;

        this.ball.vx = shoveDirX * 14 + (Math.random() - 0.5) * 5;
        this.ball.vz = shoveDirZ * 8;
        this.ball.vy = 2.6;

        p.cannotPickupTimer = 0.18;
        p.tackleCooldown = 0.7;
        inputData.slideTrigger = false;
        return;
      }

      // Altrimenti classica scivolata difensiva
      p.isSliding = true;
      p.slideTimer = 0.45;
      const slideSpeed = currentMaxSpeed * 1.4;
      p.vx = Math.sin(p.rot) * slideSpeed;
      p.vz = Math.cos(p.rot) * slideSpeed;
      sounds.playSlide();
      return;
    }

    // Movimento con accelerazione fluida
    if (inputData.moveX !== 0 || inputData.moveZ !== 0) {
      const targetVx = inputData.moveX * currentMaxSpeed;
      const targetVz = inputData.moveZ * currentMaxSpeed;

      p.vx += (targetVx - p.vx) * 12 * dt;
      p.vz += (targetVz - p.vz) * 12 * dt;

      // Rotazione verso la direzione di corsa
      p.rot = Math.atan2(inputData.moveX, inputData.moveZ);
    } else {
      // Decelerazione / attrito
      p.vx *= 0.8;
      p.vz *= 0.8;
    }

    p.x += p.vx * dt;
    p.z += p.vz * dt;

    // Limiti del campo per i giocatori
    const maxX = this.FIELD_W / 2 + 1;
    const maxZ = this.FIELD_H / 2 + 1;
    p.x = Math.max(-maxX, Math.min(maxX, p.x));
    p.z = Math.max(-maxZ, Math.min(maxZ, p.z));

    // Animazione bobbing corsa
    const currentSpeed = Math.hypot(p.vx, p.vz);
    if (currentSpeed > 0.5) {
      p.mesh.position.y = Math.sin(performance.now() * 0.015) * 0.12 * p.scale;
    } else {
      p.mesh.position.y = 0;
    }

    p.mesh.position.x = p.x;
    p.mesh.position.z = p.z;
    p.mesh.rotation.y = p.rot;

    // Contrasto e Ruba Palla in piedi: se questo giocatore è vicino al portatore avversario
    if (this.ball.holder && this.ball.holder.team !== p.team && !p.isSliding) {
      const carrier = this.ball.holder;
      const distToCarrier = Math.hypot(p.x - carrier.x, p.z - carrier.z);
      if (distToCarrier < 1.85 * p.scale && carrier.protectionTimer <= 0 && p.tackleCooldown <= 0) {
        p.tackleCooldown = 0.5;
        // Probabilità di vincere il contrasto in base a stat tackle e tempo in cui l'avversario trattiene palla
        const tackleChance = 0.55 + (stats.tackle / 200) + Math.min(0.40, carrier.possessionTime * 0.3);
        if (Math.random() < tackleChance) {
          // RUBA PALLA CON SUCCESSO!
          this.ball.holder = p;
          p.possessionTime = 0;
          p.protectionTimer = 0.35;
          p.cannotPickupTimer = 0;
          carrier.protectionTimer = 0;
          carrier.tackleCooldown = 0.6;
          carrier.possessionTime = 0;
          sounds.playKick(0.55);

          // Auto-switch se la palla viene rubata da un compagno della squadra controllata
          this._autoSwitchToPlayer(p.team, p.index);
        } else {
          // Contrasto duro / rimpallo che libera la palla
          this.ball.holder = null;
          this.ball.lastKicker = p;
          this.chargeMeter(p.team, 12);
          p.cannotPickupTimer = 0.25;
          carrier.cannotPickupTimer = 0.25;
          carrier.protectionTimer = 0;
          const bounceAngle = Math.random() * Math.PI * 2;
          this.ball.vx = Math.cos(bounceAngle) * 9.0;
          this.ball.vz = Math.sin(bounceAngle) * 9.0;
          this.ball.vy = 2.0;
          sounds.playKick(0.35);
        }
      }
    }

    // Gestione possesso palla
    if (this.ball.holder === p) {
      p.possessionTime += dt;

      // Conduzione palla organica e fluida con allungo palla in scatto (Sprint Knock-on)
      const leadDist = inputData.sprint ? (1.55 * p.scale) : (0.95 * p.scale);
      const targetBallX = p.x + Math.sin(p.rot) * leadDist;
      const targetBallZ = p.z + Math.cos(p.rot) * leadDist;

      this.ball.x += (targetBallX - this.ball.x) * 22 * dt;
      this.ball.z += (targetBallZ - this.ball.z) * 22 * dt;
      this.ball.y = this.ball.radius + Math.abs(Math.sin(performance.now() * 0.018)) * 0.12;
      this.ball.vx = p.vx;
      this.ball.vz = p.vz;
      this.ball.vy = 0;

      // Aggiorna istantaneamente la mesh Three.js e l'ombra
      this.ballMesh.position.set(this.ball.x, this.ball.y, this.ball.z);
      this.ballShadow.position.set(this.ball.x, 0.02, this.ball.z);
      this.ballShadow.scale.set(1.0, 1.0, 1);

      // Esegui tiro se rilasciato o presente nel buffer
      const triggerShoot = inputData.shootTrigger || (inputData.shotBufferTimer && inputData.shotBufferTimer > 0);

      if (triggerShoot) {
        const shotPowerNorm = Math.max(0.45, inputData.shotPower || 0.7);
        const powerMult = 21 + (stats.shot / 100) * 15;
        const finalSpeed = shotPowerNorm * powerMult;

        // Mira SEMPRE verso la porta avversaria (niente tiri all'indietro!)
        const targetGoalX = (p.team === 1) ? this.FIELD_W / 2 : -this.FIELD_W / 2;

        // Mira manuale dell'angolo con stick / frecce Su/Giù:
        let targetGoalZ = 0;
        if (inputData.moveZ < -0.15) {
          targetGoalZ = -this.GOAL_W / 2 + 1.0; // Incrocia all'angolino alto
        } else if (inputData.moveZ > 0.15) {
          targetGoalZ = this.GOAL_W / 2 - 1.0;  // Incrocia all'angolino basso
        } else {
          // Se dritto, piazza sul secondo palo aperto
          targetGoalZ = (p.z > 0) ? (-this.GOAL_W / 2 + 1.2) : (this.GOAL_W / 2 - 1.2);
        }

        const dirX = targetGoalX - p.x;
        const dirZ = targetGoalZ - p.z;
        const distToGoal = Math.hypot(dirX, dirZ) || 1;
        const forwardX = dirX / distToGoal;
        const forwardZ = dirZ / distToGoal;

        // Effetto a girare (spin Z) se il giocatore imprime inclinazione durante il tiro (Tiro a Giro / Curva)
        let spin = 0;
        if (Math.abs(inputData.moveZ) > 0.2) {
          spin = Math.sign(inputData.moveZ) * (p.team === 1 ? -1 : 1) * 7.5;
        }
        this.ball.spinZ = spin;

        // 1. Libera immediatamente il possesso e attiva cooldown al tiratore per non farlo riagganciare
        this.ball.holder = null;
        this.ball.lastShooter = p;
        this.ball.lastKicker = p;
        this.chargeMeter(p.team, 12);
        p.cannotPickupTimer = 0.45;
        p.possessionTime = 0;

        // 2. Proietta la palla davanti al tiratore fuori dalla portata dei piedi
        this.ball.x = p.x + forwardX * (1.35 * p.scale);
        this.ball.z = p.z + forwardZ * (1.35 * p.scale);
        this.ball.y = this.ball.radius + 0.3;

        this.ball.vx = forwardX * finalSpeed;
        this.ball.vz = forwardZ * finalSpeed;
        // Parabola calibrata: rasoterra pungente se tocco rapido, bolide aereo se caricato
        this.ball.vy = 2.0 + shotPowerNorm * 5.2;

        this.ballMesh.position.set(this.ball.x, this.ball.y, this.ball.z);
        this.ballShadow.position.set(this.ball.x, 0.02, this.ball.z);

        if (shotPowerNorm > 0.75) {
          sounds.playPowerShot();
          this.addCameraShake(0.65);
        } else {
          sounds.playKick(shotPowerNorm);
        }

        inputData.shootTrigger = false;
        inputData.shotBufferTimer = 0;
        inputData.shotPower = 0;
        inputData.isChargingShot = false;
      }
      // Esegui passaggio corto o filtrante / cross (con supporto buffer pass per mobile)
      else if (inputData.passTrigger || (inputData.passBufferTimer && inputData.passBufferTimer > 0)) {
        const teammates = (p.team === 1) ? this.playersTeam1 : this.playersTeam2;
        const otherTeammates = teammates.filter(mate => mate !== p && !mate.isExpelled);

        // Trova compagno migliore da servire (rispettando chiamata passaggio in 2v2/3v3 ed escludendo espulsi)
        let bestTarget = otherTeammates[0] || teammates[0];
        if (p._forcedPassTarget && !p._forcedPassTarget.isExpelled && p._forcedPassTarget !== p) {
          bestTarget = p._forcedPassTarget;
        } else {
          let bestScore = -9999;

          otherTeammates.forEach(mate => {
            const dx = mate.x - p.x;
            const dz = mate.z - p.z;
            const dist = Math.hypot(dx, dz);
            const forwardBonus = (p.team === 1) ? (mate.x - p.x) * 1.5 : (p.x - mate.x) * 1.5;
            const score = forwardBonus - dist * 0.4;
            if (score > bestScore) {
              bestScore = score;
              bestTarget = mate;
            }
          });
        }
        p._forcedPassTarget = null;

        const dx = bestTarget.x - p.x;
        const dz = bestTarget.z - p.z;
        const dist = Math.hypot(dx, dz) || 1;
        const passDirX = dx / dist;
        const passDirZ = dz / dist;
        const passSpeed = Math.min(27, Math.max(15, dist * 1.3));

        // Cross morbido aereo / pallonetto se si tiene premuto sprint o a grande distanza
        const isLob = inputData.sprint || dist > 14;

        // 1. Libera immediatamente il possesso e attiva cooldown al passatore
        this.ball.holder = null;
        this.ball.lastKicker = p;
        this.chargeMeter(p.team, 10);
        p.cannotPickupTimer = 0.45;
        p.possessionTime = 0;

        // 2. Proietta la palla davanti al passatore verso il compagno
        this.ball.x = p.x + passDirX * (1.25 * p.scale);
        this.ball.z = p.z + passDirZ * (1.25 * p.scale);
        this.ball.y = this.ball.radius + 0.2;

        if (isLob) {
          this.ball.vx = passDirX * passSpeed * 0.95;
          this.ball.vz = passDirZ * passSpeed * 0.95;
          this.ball.vy = 5.2 + Math.min(2.5, dist * 0.08); // Parabola aerea per cross morbido
          sounds.playVolley();
        } else {
          this.ball.vx = passDirX * passSpeed;
          this.ball.vz = passDirZ * passSpeed;
          this.ball.vy = 0.8;
          sounds.playKick(0.7);
        }

        this.ballMesh.position.set(this.ball.x, this.ball.y, this.ball.z);
        this.ballShadow.position.set(this.ball.x, 0.02, this.ball.z);

        inputData.passTrigger = false;
        inputData.passBufferTimer = 0;

        // Auto-switch immediato al ricevitore se il passaggio è della squadra controllata
        this._autoSwitchToPlayer(p.team, bestTarget.index);
      }
    } else {
      p.possessionTime = 0;
      const distToBall = Math.hypot(p.x - this.ball.x, p.z - this.ball.z);

      // TIRO DI PRIMA O TIRO AL VOLO / ROVESCIATA:
      // Se il giocatore umano è vicino alla palla (< 2.6m) e ha premuto tiro
      const triggerFirstTime = (inputData.shootTrigger || (inputData.shotBufferTimer && inputData.shotBufferTimer > 0));
      if (triggerFirstTime && distToBall < 2.6 * p.scale && !this.ball.holder && isHuman && (!p.cannotPickupTimer || p.cannotPickupTimer <= 0)) {
        const isAerial = (this.ball.y > 0.85);
        const shotPowerNorm = Math.max(0.5, inputData.shotPower || 0.75);

        const targetGoalX = (p.team === 1) ? this.FIELD_W / 2 : -this.FIELD_W / 2;
        let targetGoalZ = (inputData.moveZ < -0.15) ? -4.5 : ((inputData.moveZ > 0.15) ? 4.5 : 0);
        const dirX = targetGoalX - p.x;
        const dirZ = targetGoalZ - p.z;
        const distToGoal = Math.hypot(dirX, dirZ) || 1;
        const forwardX = dirX / distToGoal;
        const forwardZ = dirZ / distToGoal;

        p.cannotPickupTimer = 0.5;
        this.ball.lastShooter = p;
        this.ball.lastKicker = p;
        this.chargeMeter(p.team, 15);

        if (isAerial) {
          // TIRO AL VOLO / INCORNATA / ROVESCIATA SPETTACOLARE!
          const volleySpeed = (25 + (stats.shot / 100) * 16) * 1.35;
          this.ball.vx = forwardX * volleySpeed;
          this.ball.vz = forwardZ * volleySpeed;
          this.ball.vy = 1.4; // Siluro teso
          this.ball.spinZ = (Math.random() - 0.5) * 8.0;

          p.mesh.position.y = 1.25 * p.scale;
          p.mesh.rotation.x = -Math.PI / 2.6; // Inclinazione acrobatica
          sounds.playVolley();
          this.addCameraShake(1.15);
        } else {
          // Tiro di prima rasoterra calibrato
          const groundSpeed = (20 + (stats.shot / 100) * 14) * shotPowerNorm;
          this.ball.vx = forwardX * groundSpeed;
          this.ball.vz = forwardZ * groundSpeed;
          this.ball.vy = 2.4 + shotPowerNorm * 3.6;
          sounds.playKick(shotPowerNorm);
          this.addCameraShake(0.5);
        }

        inputData.shootTrigger = false;
        inputData.shotBufferTimer = 0;
        inputData.shotPower = 0;
        inputData.isChargingShot = false;
      }

      // Controlla intercetto / aggancio palla vagante (portiere umano ha raggio di presa maggiore)
      const isHumanGK = (isHuman && p.role === 'gk');
      const pickupRadius = (isHumanGK ? 2.35 : (isHuman ? 1.6 : 1.25)) * p.scale;
      const maxPickupY = isHumanGK ? 3.2 : 2.0;
      if (distToBall < pickupRadius && this.ball.y < maxPickupY && !this.ball.holder && (!p.cannotPickupTimer || p.cannotPickupTimer <= 0)) {
        p._forcedPassTarget = null;
        this.ball.holder = p;
        this.ball.lastPossessor = p;
        this.ball.isSpecialShot = false;
        p.possessionTime = 0;
        p.protectionTimer = 0.35; // 0.35s di protezione iniziale
        sounds.playKick(0.4);

        // AUTO-SWITCH: se un compagno della squadra controllata prende la palla, passa subito il controllo a lui!
        this._autoSwitchToPlayer(p.team, p.index);
      }
    }
  }

  // Intelligenza Artificiale Calibrata (Intelligente ma più passiva, lasciando il pieno controllo al giocatore)
  updateAI(p, dt) {
    if (p.isExpelled) {
      this.updatePlayer(p, {}, dt);
      return;
    }

    const stats = p.charData;
    const aiInput = {
      moveX: 0,
      moveZ: 0,
      sprint: false,
      isChargingShot: false,
      shotPower: 0,
      shootTrigger: false,
      passTrigger: false,
      slideTrigger: false
    };

    const myTeam = (p.team === 1) ? this.playersTeam1 : this.playersTeam2;
    const oppTeam = (p.team === 1) ? this.playersTeam2 : this.playersTeam1;
    const targetGoalX = (p.team === 1) ? this.FIELD_W / 2 : -this.FIELD_W / 2;
    const ownGoalX = (p.team === 1) ? -this.FIELD_W / 2 : this.FIELD_W / 2;

    const humanPlayer = this._getPrimaryHumanOnTeam(p.team, p);
    const isUserTeam = Boolean(humanPlayer);

    const distToBall = Math.hypot(p.x - this.ball.x, p.z - this.ball.z);
    const hasBall = (this.ball.holder === p);

    // ============================================
    // 1. IL GIOCATORE AI HA LA PALLA
    // ============================================
    if (hasBall) {
      if (p._forcedPassTarget && !p._forcedPassTarget.isExpelled && p.possessionTime > 0.08) {
        aiInput.passTrigger = true;
      } else if (p.role === 'gk') {
        // Portiere CPU distribuisce subito la palla ai compagni di squadra
        const dx = targetGoalX - p.x;
        const dz = -p.z * 0.4;
        const len = Math.hypot(dx, dz) || 1;
        aiInput.moveX = dx / len;
        aiInput.moveZ = dz / len;
        if (p.possessionTime > 0.45) {
          aiInput.passTrigger = true;
        }
      } else if (isUserTeam) {
        // Compagno di squadra dell'utente ha la palla: cerca passaggio all'utente, avanza o tira vicino alla porta
        const distToHuman = humanPlayer ? Math.hypot(p.x - humanPlayer.x, p.z - humanPlayer.z) : 999;
        const distToGoal = Math.abs(targetGoalX - p.x);
        if (distToGoal < 13 && Math.abs(p.z) < 8 && p.possessionTime > 0.7 && Math.random() < 0.06) {
          aiInput.shootTrigger = true;
          aiInput.shotPower = 0.65;
        } else if (humanPlayer && p !== humanPlayer && distToHuman < 26 && p.possessionTime > 0.45 && Math.random() < 0.045) {
          aiInput.passTrigger = true;
        } else {
          const dx = targetGoalX - p.x;
          const dz = -p.z * 0.35;
          const len = Math.hypot(dx, dz) || 1;
          aiInput.moveX = dx / len;
          aiInput.moveZ = dz / len;
        }
      } else {
        // CPU avversaria ha la palla: avanza a passo controllato (senza sprintare)
        const distToGoal = Math.abs(targetGoalX - p.x);
        const oppMeter = (p.team === 1) ? this.specialMeter1 : this.specialMeter2;

        // Tira SOLO se molto vicina alla porta (< 15 metri) e centrale, dopo aver controllato la palla
        if (oppMeter >= 100 && distToGoal < 28 && p.possessionTime > 0.6 && Math.random() < 0.05) {
          this.triggerSpecial(p.team, p.index);
        } else if (distToGoal < 15 && Math.abs(p.z) < 9 && p.possessionTime > 0.8) {
          aiInput.shootTrigger = true;
          aiInput.shotPower = 0.55 + Math.random() * 0.25;
        } else {
          // Avanza verso la porta a passo moderato
          const dirX = targetGoalX - p.x;
          const dirZ = -p.z * 0.3;
          const len = Math.hypot(dirX, dirZ) || 1;
          aiInput.moveX = dirX / len;
          aiInput.moveZ = dirZ / len;
          aiInput.sprint = false; // Non scatta: l'utente può raggiungerla e toglierle palla!

          // Passaggio occasionale al compagno
          if (p.possessionTime > 1.2 && Math.random() < 0.025) {
            aiInput.passTrigger = true;
          }
        }
      }
    }
    // ============================================
    // 2. NESSUNO HA LA PALLA (PALLA VAGANTE)
    // ============================================
    else if (!this.ball.holder) {
      const humanDistToBall = humanPlayer ? Math.hypot(humanPlayer.x - this.ball.x, humanPlayer.z - this.ball.z) : 999;

      if (p.role !== 'gk' && isUserTeam && humanPlayer) {
        // Compagno di squadra dell'utente:
        // Se l'utente è vicino alla palla (< 8m), si smarca per ricevere; altrimenti va a recuperarla
        if (humanDistToBall < 8 && p !== humanPlayer) {
          const targetX = humanPlayer.x + (p.team === 1 ? 12 : -12);
          const targetZ = p.baseZ + (this.ball.z * 0.3);
          const dx = targetX - p.x;
          const dz = targetZ - p.z;
          const len = Math.hypot(dx, dz);
          if (len > 1.0) {
            aiInput.moveX = dx / len;
            aiInput.moveZ = dz / len;
          }
        } else {
          // Va verso la palla per recuperarla
          const dx = this.ball.x - p.x;
          const dz = this.ball.z - p.z;
          const len = Math.hypot(dx, dz);
          if (len > 0.4) {
            aiInput.moveX = dx / len;
            aiInput.moveZ = dz / len;
          }
        }
      } else {
        // CPU avversaria su palla vagante o tiro in arrivo:
        if (p.role === 'gk') {
          const ballMovingToGoal = (p.team === 1) ? (this.ball.vx < -4) : (this.ball.vx > 4);
          const idealX = ownGoalX + (p.team === 1 ? 5.2 : -5.2);

          if (ballMovingToGoal) {
            // Anticipa la traiettoria del tiro verso la linea di porta
            const timeToGoal = Math.abs(ownGoalX - this.ball.x) / Math.max(1, Math.abs(this.ball.vx));
            const predictedZ = this.ball.z + this.ball.vz * timeToGoal;
            const clampedZ = Math.max(-this.GOAL_W / 2 + 0.8, Math.min(this.GOAL_W / 2 - 0.8, predictedZ));

            const dx = idealX - p.x;
            const dz = clampedZ - p.z;
            const len = Math.hypot(dx, dz);
            if (len > 0.25) {
              aiInput.moveX = dx / len;
              aiInput.moveZ = dz / len;
              aiInput.sprint = true;
            }

            // Parata o tuffo acrobatico se il tiro è a portata (< 3.2m)
            const distBall = Math.hypot(this.ball.x - p.x, this.ball.z - p.z);
            if (distBall < 3.2 && (!p.cannotPickupTimer || p.cannotPickupTimer <= 0)) {
              const shotSpeed = Math.hypot(this.ball.vx, this.ball.vz);
              if (this.ball.isSpecialShot) {
                // Impatto tremendo della Super: il portiere viene sbalzato all'indietro
                sounds.playGloveSave();
                this.addCameraShake(0.85);
                p.mesh.rotation.z = Math.sign(this.ball.vz || 1) * 0.8;
                p.vx = Math.sign(ownGoalX) * 9;
                p.isSliding = true;
                p.slideTimer = 0.5;
              } else if (shotSpeed < 20 && Math.random() < 0.52) {
                // Presa sicura a due mani
                this.ball.holder = p;
                p.possessionTime = 0;
                p.protectionTimer = 0.8;
                sounds.playKick(0.5);
              } else {
                // Deviazione spettacolare in tuffo a guanto aperto!
                sounds.playGloveSave();
                this.addCameraShake(0.65);
                p.mesh.rotation.z = Math.sign(this.ball.vz || 1) * 0.85;
                p.cannotPickupTimer = 0.45;

                this.ball.vx = -this.ball.vx * 0.55;
                this.ball.vz = Math.sign(this.ball.z || 1) * 11 + (Math.random() - 0.5) * 6;
                this.ball.vy = 2.8;
                this.ball.spinZ = 0;
              }
            }
          } else if (Math.abs(this.ball.x - ownGoalX) < 11) {
            const dx = this.ball.x - p.x;
            const dz = this.ball.z - p.z;
            const len = Math.hypot(dx, dz);
            if (len > 0.3) {
              aiInput.moveX = dx / len;
              aiInput.moveZ = dz / len;
            }
          } else {
            const idealZ = Math.max(-this.GOAL_W / 2 + 1, Math.min(this.GOAL_W / 2 - 1, this.ball.z * 0.6));
            const dx = idealX - p.x;
            const dz = idealZ - p.z;
            const len = Math.hypot(dx, dz);
            if (len > 1.0) {
              aiInput.moveX = dx / len;
              aiInput.moveZ = dz / len;
            }
          }
        } else {
          // Trova il giocatore CPU di movimento più vicino alla palla (escludendo portiere, espulsi e giocatori umani)
          let closestCpu = null;
          let minCpuDist = 9999;
          myTeam.forEach(cp => {
            if (cp.role !== 'gk' && !cp.isExpelled && !this._isSlotHumanControlled(p.team, cp.index)) {
              const d = Math.hypot(cp.x - this.ball.x, cp.z - this.ball.z);
              if (d < minCpuDist) { minCpuDist = d; closestCpu = cp; }
            }
          });

          if (p === closestCpu) {
            // Corre verso la palla per conquistarla!
            const dx = this.ball.x - p.x;
            const dz = this.ball.z - p.z;
            const len = Math.hypot(dx, dz);
            if (len > 0.4) {
              aiInput.moveX = dx / len;
              aiInput.moveZ = dz / len;
              aiInput.sprint = (len > 5.0);
            }
          } else {
            // L'altro compagno mantiene il posizionamento tattico
            const targetX = p.baseX + (this.ball.x * 0.25);
            const targetZ = p.baseZ + (this.ball.z * 0.2);
            const dx = targetX - p.x;
            const dz = targetZ - p.z;
            const len = Math.hypot(dx, dz);
            if (len > 1.2) {
              aiInput.moveX = dx / len;
              aiInput.moveZ = dz / len;
            }
          }
        }
      }
    }
    // ============================================
    // 3. LA SQUADRA AVVERSARIA HA LA PALLA (Fase Difensiva)
    // ============================================
    else {
      const holder = this.ball.holder;

      if (isUserTeam) {
        // Compagni di squadra dell'utente in difesa
        if (p.role === 'gk') {
          const idealX = ownGoalX + (p.team === 1 ? 5 : -5);
          const idealZ = Math.max(-this.GOAL_W / 2 + 1, Math.min(this.GOAL_W / 2 - 1, this.ball.z * 0.6));
          const dx = idealX - p.x;
          const dz = idealZ - p.z;
          const len = Math.hypot(dx, dz);
          if (len > 0.8) {
            aiInput.moveX = dx / len;
            aiInput.moveZ = dz / len;
          }
        } else if (holder.team === p.team) {
          // Un compagno ha la palla: smarcati in avanti lungo la propria fascia
          const targetX = Math.max(-this.FIELD_W / 2 + 6, Math.min(this.FIELD_W / 2 - 6, holder.x + (p.team === 1 ? 11 : -11)));
          const targetZ = p.baseZ * 0.85;
          const dx = targetX - p.x;
          const dz = targetZ - p.z;
          const len = Math.hypot(dx, dz);
          if (len > 1.2) {
            aiInput.moveX = dx / len;
            aiInput.moveZ = dz / len;
          }
        } else {
          // Copertura e pressing se l'avversario è vicino
          const distToHolder = Math.hypot(p.x - holder.x, p.z - holder.z);
          if (distToHolder < 6.0) {
            const dx = holder.x - p.x;
            const dz = holder.z - p.z;
            const len = Math.hypot(dx, dz);
            if (len > 0.5) {
              aiInput.moveX = dx / len;
              aiInput.moveZ = dz / len;
            }
          } else {
            const targetX = p.baseX + (this.ball.x * 0.3);
            const targetZ = p.baseZ + (this.ball.z * 0.25);
            const dx = targetX - p.x;
            const dz = targetZ - p.z;
            const len = Math.hypot(dx, dz);
            if (len > 1.2) {
              aiInput.moveX = dx / len;
              aiInput.moveZ = dz / len;
            }
          }
        }
      } else {
        // CPU DIFENDE CONTRO L'UTENTE (Equilibrata, contrasta e ruba palla senza essere scorretta):
        // 1. Trova il difensore CPU di movimento più vicino al portatore
        let closestDefender = null;
        let minDefDist = 9999;
        myTeam.forEach(cp => {
          if (cp.role !== 'gk' && !cp.isExpelled && !this._isSlotHumanControlled(p.team, cp.index)) {
            const d = Math.hypot(cp.x - holder.x, cp.z - holder.z);
            if (d < minDefDist) { minDefDist = d; closestDefender = cp; }
          }
        });

        if (p === closestDefender) {
          // DIFENSORE PRIMARIO:
          // Va incontro con decisione al portatore per rubare palla e contrastarlo!
          const dx = holder.x - p.x;
          const dz = holder.z - p.z;
          const dist = Math.hypot(dx, dz);

          if (dist > 0.4) {
            aiInput.moveX = dx / dist;
            aiInput.moveZ = dz / dist;
            aiInput.sprint = (dist > 2.2); // Scatto deciso in pressing
          }

          // Se il portatore è a portata di tackle (< 2.2m) e ha la palla da oltre 0.25s:
          if (dist < 2.2 && holder.possessionTime > 0.25 && p.tackleCooldown <= 0) {
            if (dist > 1.35) {
              // Scivolata / contrasto in allungo
              aiInput.slideTrigger = true;
              p.tackleCooldown = 0.9;
            } else {
              // Contrasto duro in piedi o spallata
              aiInput.slideTrigger = (Math.random() < 0.45);
              p.tackleCooldown = 0.5;
            }
          }
        } else if (p.role === 'gk') {
          // Portiere CPU: difende la linea
          const idealX = ownGoalX + (p.team === 1 ? 5 : -5);
          const idealZ = Math.max(-this.GOAL_W / 2 + 1, Math.min(this.GOAL_W / 2 - 1, this.ball.z * 0.55));
          const dx = idealX - p.x;
          const dz = idealZ - p.z;
          const len = Math.hypot(dx, dz);
          if (len > 0.8) {
            aiInput.moveX = dx / len;
            aiInput.moveZ = dz / len;
          }
        } else {
          // L'altro difensore copre la traiettoria verso la porta
          const targetX = (ownGoalX + holder.x) * 0.5;
          const targetZ = holder.z * 0.6;
          const dx = targetX - p.x;
          const dz = targetZ - p.z;
          const len = Math.hypot(dx, dz);
          if (len > 1.0) {
            aiInput.moveX = dx / len;
            aiInput.moveZ = dz / len;
          }
        }
      }
    }

    this.updatePlayer(p, aiInput, dt);
  }

  // Ricarica la Super Gauge
  chargeMeter(teamNum, amount) {
    if (teamNum === 1) {
      this.specialMeter1 = Math.min(100, this.specialMeter1 + amount);
      if (this.specialMeter1 >= 100 && !this.specialAudioPlayed1) {
        sounds.playSpecialReady();
        this.specialAudioPlayed1 = true;
      }
    } else {
      this.specialMeter2 = Math.min(100, this.specialMeter2 + amount);
      if (this.specialMeter2 >= 100 && !this.specialAudioPlayed2) {
        sounds.playSpecialReady();
        this.specialAudioPlayed2 = true;
      }
    }
  }

  // Scatena la Super Abilità Mario Strikers
  triggerSpecial(teamNum, overridePlayerIdx = null) {
    if (this.state !== 'playing') return false;
    const meter = (teamNum === 1) ? this.specialMeter1 : this.specialMeter2;
    if (meter < 100) {
      sounds.playBeep(260, 0.08);
      return false;
    }

    // Consuma Super Gauge
    if (teamNum === 1) {
      this.specialMeter1 = 0;
      this.specialAudioPlayed1 = false;
    } else {
      this.specialMeter2 = 0;
      this.specialAudioPlayed2 = false;
    }

    const activeIdx = (teamNum === 1) ? this.activePlayerIdx1 : this.activePlayerIdx2;
    const teamArr = (teamNum === 1) ? this.playersTeam1 : this.playersTeam2;
    const playerIdx = (typeof overridePlayerIdx === 'number' && teamArr[overridePlayerIdx] && !teamArr[overridePlayerIdx].isExpelled)
      ? overridePlayerIdx
      : activeIdx;
    const player = teamArr[playerIdx] || teamArr[2] || teamArr[0];
    const char = player.charData;

    // Cut-in Cinematic Mario Strikers
    if (this.options.onSpecialTrigger) {
      this.options.onSpecialTrigger({ player, charData: char });
    }
    this.emitGameEvent({
      event: 'special',
      team: teamNum,
      playerIndex: playerIdx,
      charId: char.id,
      playerName: player.name,
      charName: char.name,
      specialType: char.specialType
    });

    // Effetti Sonori Dedicati
    sounds.playSpecialStrike(char.specialType);
    if (char.id === 'ara') {
      sounds.playEagleCry();
    } else if (char.id === 'lollo') {
      sounds.playBeerShot();
    } else if (char.id === 'ento') {
      sounds.playRedCardWhistle();
    }

    // Libera la palla e prepara la super mossa
    this.ball.holder = null;
    player.cannotPickupTimer = 0.7;

    const targetGoalX = (teamNum === 1) ? (this.FIELD_W / 2) : (-this.FIELD_W / 2);
    const oppTeam = (teamNum === 1) ? this.playersTeam2 : this.playersTeam1;

    // Esegui la super mossa specifica
    switch (char.id) {
      case 'ara': { // TIRO DELL'OCCHIO DI FALCO
        const targetZ = (player.z >= 0) ? (this.GOAL_W / 2 - 1.2) : (-this.GOAL_W / 2 + 1.2);
        const dx = targetGoalX - player.x;
        const dz = targetZ - player.z;
        const dist = Math.hypot(dx, dz) || 1;

        this.ball.x = player.x + (dx / dist) * 1.5;
        this.ball.z = player.z + (dz / dist) * 1.5;
        this.ball.y = 1.3;

        const hawkSpeed = 38;
        this.ball.vx = (dx / dist) * hawkSpeed;
        this.ball.vz = (dz / dist) * hawkSpeed;
        this.ball.vy = 4.0;

        this.ball.isSpecialShot = true;
        this.ball.specialType = 'hawkeye';
        this.ball.specialShooter = player;
        this.ball.lastShooter = player;
        this.ball.lastKicker = player;

        // Onda d'urto ad anello: spazza via i difensori vicini
        oppTeam.forEach(opp => {
          const dOpp = Math.hypot(opp.x - player.x, opp.z - player.z);
          if (dOpp < 7.5) {
            opp.vx = Math.sign(opp.x - player.x || 1) * 10;
            opp.vz = Math.sign(opp.z - player.z || 1) * 10;
            opp.isSliding = true;
            opp.slideTimer = 1.2;
          }
        });
        break;
      }

      case 'ento': { // CARTELLINO ROSSO DELLO SBIRRO ARBITRO
        sounds.playRedCardWhistle();
        this.addCameraShake(0.85);

        // Trova l'avversario più pericoloso (o il portatore di palla)
        let expelled = (this.ball.holder && this.ball.holder.team !== teamNum) ? this.ball.holder : null;
        if (!expelled) {
          let maxRating = -1;
          oppTeam.forEach(opp => {
            const rating = (opp.charData.shot || 0) + (opp.charData.speed || 0);
            if (rating > maxRating && !opp.isExpelled) {
              maxRating = rating;
              expelled = opp;
            }
          });
        }
        if (!expelled) expelled = oppTeam[0];

        if (expelled) {
          expelled.isExpelled = true;
          expelled.expelledTimer = 12.0; // Espulso dal campo per 12 secondi!
          expelled.cannotPickupTimer = 12.0;
          expelled.protectionTimer = 0;
          if (this.ball.holder === expelled) {
            this.ball.holder = null;
            this.ball.vx = (Math.random() - 0.5) * 6;
            this.ball.vz = (Math.random() - 0.5) * 6;
            this.ball.vy = 2.0;
          }
          expelled.x = (expelled.team === 1 ? -12 : 12);
          expelled.z = (this.FIELD_H / 2) + 4.5;
          expelled.vx = 0;
          expelled.vz = 0;
          expelled.mesh.position.set(expelled.x, 0, expelled.z);

          if (expelled.team === 1 && this.activePlayerIdx1 === expelled.index) {
            this.switchActivePlayer(1);
          } else if (expelled.team === 2 && this.activePlayerIdx2 === expelled.index) {
            this.switchActivePlayer(2);
          }

          const toastMsg = `🟥 CARTELLINO ROSSO! ${expelled.name.toUpperCase()} ESPULSO PER 12S!`;
          if (this.options.onToast) {
            this.options.onToast(toastMsg);
          }
          this.emitGameEvent({ event: 'toast', text: toastMsg });
        }
        this.ball.holder = player;
        player.protectionTimer = 1.6;
        break;
      }

      case 'lindi': { // ROVESCIATA DA BALLER (L'ATTACCANTE PIÙ FORTE)
        const targetZ = (player.z >= 0) ? -4.5 : 4.5;
        const dx = targetGoalX - player.x;
        const dz = targetZ - player.z;
        const dist = Math.hypot(dx, dz) || 1;

        // Balzo e rovesciata acrobatica in aria
        player.mesh.position.y = 2.4 * player.scale;
        player.mesh.rotation.x = -Math.PI * 1.5;

        this.ball.x = player.x + (dx / dist) * 1.5;
        this.ball.z = player.z + (dz / dist) * 1.5;
        this.ball.y = 2.2;

        const ballerSpeed = 44; // Bordata atomica da bomber #1
        this.ball.vx = (dx / dist) * ballerSpeed;
        this.ball.vz = (dz / dist) * ballerSpeed;
        this.ball.vy = 2.6;

        this.ball.isSpecialShot = true;
        this.ball.specialType = 'baller_bicycle';
        this.ball.specialShooter = player;
        this.ball.lastShooter = player;
        this.ball.lastKicker = player;

        sounds.playVolley();
        this.addCameraShake(1.4);

        // Onda d'urto che travolge i difensori
        oppTeam.forEach(opp => {
          const dOpp = Math.hypot(opp.x - player.x, opp.z - player.z);
          if (dOpp < 9.0) {
            opp.vx = Math.sign(opp.x - player.x || 1) * 11;
            opp.vz = Math.sign(opp.z - player.z || 1) * 11;
            opp.isSliding = true;
            opp.slideTimer = 1.3;
          }
        });
        break;
      }

      case 'bubi': { // BLOCCO ROCCIOSO TOTALE (VICE CAPITANO ROCCIA)
        oppTeam.forEach(opp => {
          opp.isSliding = true;
          opp.slideTimer = 2.8; // Atterra e congela tutti
          opp.cannotPickupTimer = 2.8;
          opp.protectionTimer = 0;
          opp.vx = 0;
          opp.vz = 0;
        });
        this.ball.holder = player;
        player.protectionTimer = 2.0;
        sounds.playBodyCheck();
        this.addCameraShake(1.2);
        break;
      }

      case 'jona': { // CARICA DELLA GARRA & CAZZIMMA DEL CAPITANO
        oppTeam.forEach(opp => {
          const d = Math.hypot(opp.x - player.x, opp.z - player.z);
          if (d < 16) {
            opp.isSliding = true;
            opp.slideTimer = 2.2;
            opp.cannotPickupTimer = 2.2;
            opp.protectionTimer = 0;
            opp.vx = Math.sign(opp.x - player.x || 1) * 14;
            opp.vz = Math.sign(opp.z - player.z || 1) * 10;
          }
        });
        this.ball.holder = player;
        player.protectionTimer = 2.4;
        player.vx = Math.sign(targetGoalX - player.x) * 18;
        sounds.playPowerShot();
        this.addCameraShake(1.15);
        break;
      }

      case 'matti': { // MURO DEL MURATORE (BLOCCA TUTTI GLI ATTACCHI)
        this.goalShieldTeam = teamNum;
        this.goalShieldTimer = 12.0; // 12 secondi di porta blindata dal muro!
        oppTeam.forEach(opp => {
          opp.isSliding = true;
          opp.slideTimer = 2.2;
          opp.cannotPickupTimer = 2.2;
          opp.protectionTimer = 0;
          opp.vx = Math.sign(opp.x - player.x || 1) * 12;
          opp.vz = Math.sign(opp.z - player.z || 1) * 8;
        });
        this.ball.holder = player;
        player.protectionTimer = 2.0;
        sounds.playBodyCheck();
        this.addCameraShake(1.15);
        break;
      }

      case 'jelmo': { // DIFENSORE FULMINE - SCATTO DEL LAMPO
        player.stamina = 100;
        player.cannotPickupTimer = 0;
        this.ball.holder = player;
        player.protectionTimer = 2.4;
        player.vx = Math.sign(targetGoalX - player.x) * 26; // Velocità fulminea 26!
        player.vz = 0;
        sounds.playPowerShot();
        this.addCameraShake(0.9);
        break;
      }

      case 'roby': { // IL DENTISTA - INTERVENTO CHIRURGICO
        oppTeam.forEach(opp => {
          const d = Math.hypot(opp.x - player.x, opp.z - player.z);
          if (d < 18) {
            opp.isSliding = true;
            opp.slideTimer = 2.5;
            opp.cannotPickupTimer = 2.5;
            opp.protectionTimer = 0;
            opp.vx = 0;
            opp.vz = 0;
          }
        });
        this.ball.holder = player;
        player.protectionTimer = 2.2;
        sounds.playSlide();
        sounds.playBodyCheck();
        this.addCameraShake(1.0);
        break;
      }

      case 'lollo': { // IL BEVITORE DI BIRRA - TIRO ALLA BIRRA
        const targetZ = (Math.random() > 0.5 ? 4.2 : -4.2);
        const dx = targetGoalX - player.x;
        const dz = targetZ - player.z;
        const dist = Math.hypot(dx, dz) || 1;
        this.ball.x = player.x + (dx / dist) * 1.5;
        this.ball.z = player.z + (dz / dist) * 1.5;
        this.ball.y = 1.3;

        const beerSpeed = 39;
        this.ball.vx = (dx / dist) * beerSpeed;
        this.ball.vz = (dz / dist) * beerSpeed + 7.0;
        this.ball.vy = 3.6;
        this.ball.spinZ = 12.0; // Effetto a curva ubriacante
        this.ball.isSpecialShot = true;
        this.ball.specialType = 'beer_shot';
        this.ball.specialShooter = player;
        this.ball.lastShooter = player;
        this.ball.lastKicker = player;

        sounds.playBeerShot();
        this.addCameraShake(1.15);
        break;
      }

      default: { // Altri tiri speciali (Pibe, Kri, Leon)
        const targetZ = (Math.random() > 0.5 ? 3.5 : -3.5);
        const dx = targetGoalX - player.x;
        const dz = targetZ - player.z;
        const dist = Math.hypot(dx, dz) || 1;
        this.ball.x = player.x + (dx / dist) * 1.5;
        this.ball.z = player.z + (dz / dist) * 1.5;
        this.ball.y = 1.2;
        const pwr = 36;
        this.ball.vx = (dx / dist) * pwr;
        this.ball.vz = (dz / dist) * pwr;
        this.ball.vy = (char.id === 'pibe' ? 6.5 : 3.8);
        this.ball.isSpecialShot = true;
        this.ball.specialType = char.id;
        this.ball.specialShooter = player;
        this.ball.lastShooter = player;
        this.ball.lastKicker = player;
        break;
      }
    }

    return true;
  }

  // Fisica vettoriale della palla (rimbalzi, pali, gol)
  updateBall(dt) {
    if (this.ball.holder) {
      // FONDAMENTALE: aggiorna SEMPRE la mesh e l'ombra anche durante il possesso
      this.ballMesh.position.set(this.ball.x, this.ball.y, this.ball.z);
      this.ballShadow.position.set(this.ball.x, 0.02, this.ball.z);
      this.ballShadow.scale.set(1.0, 1.0, 1);
      return;
    }

    // Gravità bilanciata
    this.ball.vy -= 16.0 * dt;

    // Effetto Homing del Tiro dell'Occhio di Falco di Ara (Mario Strikers)
    if (this.ball.isSpecialShot && this.ball.specialType === 'hawkeye') {
      const targetGoalX = (this.ball.specialShooter && this.ball.specialShooter.team === 1) ? (this.FIELD_W / 2) : (-this.FIELD_W / 2);
      const targetGoalZ = (this.ball.specialShooter && this.ball.specialShooter.z >= 0) ? (this.GOAL_W / 2 - 1.2) : (-this.GOAL_W / 2 + 1.2);
      this.ball.vz += (targetGoalZ - this.ball.z) * 0.14;
      if (this.ball.y < 2.0 && Math.abs(this.ball.x) < this.FIELD_W / 2 - 2) {
        this.ball.vy += 0.8;
      }
    }

    // Effetto traiettoria ubriacante del Tiro alla Birra di Lollo
    if (this.ball.isSpecialShot && this.ball.specialType === 'beer_shot') {
      this.ball.vz += Math.sin(performance.now() * 0.02) * 1.5;
      this.ball.spinZ += Math.cos(performance.now() * 0.015) * 2.2;
    }

    // Effetto aerodinamico della Rovesciata da Baller di Lindi
    if (this.ball.isSpecialShot && this.ball.specialType === 'baller_bicycle') {
      if (this.ball.y < 1.8 && Math.abs(this.ball.x) < this.FIELD_W / 2 - 2) {
        this.ball.vy += 0.55;
      }
    }

    // Scudo del Portiere (Super di Jelmo)
    if (this.goalShieldTimer > 0) {
      this.goalShieldTimer -= dt;
      const shieldGoalX = (this.goalShieldTeam === 1) ? -this.FIELD_W / 2 : this.FIELD_W / 2;
      if (Math.abs(this.ball.x - shieldGoalX) < 7 && Math.abs(this.ball.z) < this.GOAL_W / 2 + 2) {
        this.ball.vx = -Math.sign(shieldGoalX) * 24;
        this.ball.vy = 4;
        sounds.playPost();
      }
    }

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;
    this.ball.z += this.ball.vz * dt;

    // Curva aerodinamica a rientrare (Tiro a Giro / Banana shot)
    if (Math.abs(this.ball.spinZ) > 0.05) {
      this.ball.vz += this.ball.spinZ * dt;
      this.ball.spinZ *= Math.pow(0.35, dt);
    }

    // Attrito dell'erba e resistenza per rotolamento realistico e controllabile
    this.ball.vx *= (1 - 0.75 * dt);
    this.ball.vz *= (1 - 0.75 * dt);

    // Rimbalzo sul terreno
    if (this.ball.y <= this.ball.radius) {
      this.ball.y = this.ball.radius;
      if (Math.abs(this.ball.vy) > 1.2) {
        this.ball.vy = -this.ball.vy * 0.55; // rimbalzo elastico
        sounds.playKick(0.2);
      } else {
        this.ball.vy = 0;
      }
    }

    // Controlla Gol o collisione con la porta
    const halfW = this.FIELD_W / 2;
    const halfGoalW = this.GOAL_W / 2;

    // Porta Sinistra (Goal per Squadra 2)
    if (this.ball.x < -halfW) {
      if (Math.abs(this.ball.z) < halfGoalW && this.ball.y < this.GOAL_H) {
        // GOL!
        if (this.state === 'playing') {
          this.onGoalScored(2);
        }
        // Frena la palla nella rete
        this.ball.vx *= 0.2;
        this.ball.vz *= 0.2;
      } else {
        // Palo / Bordo porta
        this.ball.x = -halfW;
        this.ball.vx = -this.ball.vx * 0.7;
        sounds.playPost();
        this.addCameraShake(0.7);
      }
    }

    // Porta Destra (Goal per Squadra 1)
    if (this.ball.x > halfW) {
      if (Math.abs(this.ball.z) < halfGoalW && this.ball.y < this.GOAL_H) {
        // GOL!
        if (this.state === 'playing') {
          this.onGoalScored(1);
        }
        // Frena la palla nella rete
        this.ball.vx *= 0.2;
        this.ball.vz *= 0.2;
      } else {
        // Palo / Bordo porta
        this.ball.x = halfW;
        this.ball.vx = -this.ball.vx * 0.7;
        sounds.playPost();
        this.addCameraShake(0.7);
      }
    }

    // Bordi laterali (Sponde elastiche rimbalzanti stile Mario Strikers / calcetto indoor)
    const halfH = this.FIELD_H / 2;
    if (Math.abs(this.ball.z) > halfH) {
      this.ball.z = Math.sign(this.ball.z) * halfH;
      this.ball.vz = -this.ball.vz * 0.82;
      if (Math.abs(this.ball.vx) > 2) {
        this.ball.vx *= 0.96;
      }
      sounds.playPost();
      this.addCameraShake(0.25);
    }

    this._updateBallVisuals(dt);
  }

  _updateBallVisuals(dt) {
    // Rotazione visiva palla
    const speed = Math.hypot(this.ball.vx || 0, this.ball.vz || 0);
    this.ball.rotX += speed * dt * 2;
    this.ballMesh.rotation.x = this.ball.rotX;
    this.ballMesh.rotation.z += (this.ball.vx || 0) * dt * 2;

    // Aggiorna scia luminosa ad alta velocità / super tiro
    if (this.ballTrail && this.ballTrail.length > 0) {
      const showTrail = (speed > 18 || this.ball.isSpecialShot);
      if (showTrail) {
        for (let i = this.ballTrail.length - 1; i > 0; i--) {
          this.ballTrail[i].mesh.position.copy(this.ballTrail[i - 1].mesh.position);
          this.ballTrail[i].mesh.visible = true;
          this.ballTrail[i].mat.opacity = (1 - (i / this.ballTrail.length)) * 0.65;
          if (this.ball.specialType === 'beer_shot') {
            this.ballTrail[i].mat.color.setHex(0xf59e0b); // Scia oro spumeggiante birra
          } else if (this.ball.specialType === 'baller_bicycle') {
            this.ballTrail[i].mat.color.setHex(0xe11d48); // Scia rubino infuocata bomber
          } else if (this.ball.isSpecialShot) {
            this.ballTrail[i].mat.color.setHex(0xffaa00);
          } else {
            this.ballTrail[i].mat.color.setHex(0x00f0ff);
          }
        }
        this.ballTrail[0].mesh.position.set(this.ball.x, this.ball.y, this.ball.z);
        this.ballTrail[0].mesh.visible = true;
        this.ballTrail[0].mat.opacity = 0.75;
        if (this.ball.specialType === 'beer_shot') {
          this.ballTrail[0].mat.color.setHex(0xfbbf24);
        } else if (this.ball.specialType === 'baller_bicycle') {
          this.ballTrail[0].mat.color.setHex(0xf43f5e);
        } else {
          this.ballTrail[0].mat.color.setHex(this.ball.isSpecialShot ? 0xffdd00 : 0x00ffff);
        }
      } else {
        for (let i = 0; i < this.ballTrail.length; i++) {
          this.ballTrail[i].mat.opacity *= 0.82;
          if (this.ballTrail[i].mat.opacity < 0.05) {
            this.ballTrail[i].mesh.visible = false;
          }
        }
      }
    }

    // Aggiorna mesh
    this.ballMesh.position.set(this.ball.x, this.ball.y, this.ball.z);

    // Aggiorna ombra palla (scala e opacità variano con l'altezza)
    this.ballShadow.position.set(this.ball.x, 0.02, this.ball.z);
    const shadowScale = Math.max(0.4, 1.0 - (this.ball.y - this.ball.radius) * 0.12);
    this.ballShadow.scale.set(shadowScale, shadowScale, 1);
  }

  onGoalScored(scoringTeam) {
    this.state = 'goal';
    this.score[scoringTeam - 1]++;
    this.goalCelebrationTimer = 3.5; // 3.5 secondi di celebrazione
    this.lastScoringTeam = scoringTeam;

    sounds.playGoalCheer();
    this.addCameraShake(1.3);

    // Identifica con precisione il marcatore del gol
    const attackingPlayers = (scoringTeam === 1) ? this.playersTeam1 : this.playersTeam2;
    let scorer = this.ball.lastShooter || this.ball.lastKicker || this.ball.lastPossessor;
    if (!scorer || scorer.team !== scoringTeam) {
      scorer = attackingPlayers[0];
    }
    const isSpecialGoal = this.ball.isSpecialShot || false;

    // Reset flag speciale
    this.ball.isSpecialShot = false;

    if (this.options.onGoal) {
      this.options.onGoal(scoringTeam, this.score, scorer, isSpecialGoal);
    }
    this.emitGameEvent({
      event: 'goal',
      scoringTeam,
      score: [...this.score],
      scorerId: scorer && scorer.charData ? scorer.charData.id : null,
      isSpecialGoal
    });
  }

  // Aggiorna visuali interpolate lato Client (niente fisica/AI locale in conflitto con Host)
  updateClientVisuals(dt) {
    const smooth = this._snapNextState ? 1.0 : Math.min(1.0, 1 - Math.pow(0.0004, dt));
    const timeNow = performance.now();

    const syncTeamVisuals = (teamArr) => {
      teamArr.forEach(p => {
        if (typeof p.netX === 'number' && typeof p.netZ === 'number') {
          const prevX = p.x;
          const prevZ = p.z;
          p.x += (p.netX - p.x) * smooth;
          p.z += (p.netZ - p.z) * smooth;
          if (typeof p.netRot === 'number') p.rot = p.netRot;
          const speed = dt > 0 ? Math.hypot(p.x - prevX, p.z - prevZ) / dt : 0;
          if (this.state === 'goal' && p.team === this.lastScoringTeam) {
            p.mesh.position.y = Math.abs(Math.sin(timeNow * 0.008)) * 1.2;
          } else if (speed > 0.5 && !p.isExpelled && !p.isSliding) {
            p.mesh.position.y = Math.sin(timeNow * 0.015) * 0.12 * p.scale;
          } else {
            p.mesh.position.y = 0;
          }
          p.mesh.position.x = p.x;
          p.mesh.position.z = p.z;
          p.mesh.rotation.y = p.rot;
          p.mesh.rotation.x = p.isSliding ? Math.PI / 3 : 0;
        }
      });
    };

    syncTeamVisuals(this.playersTeam1);
    syncTeamVisuals(this.playersTeam2);

    if (typeof this.ball.netX === 'number') {
      this.ball.x += (this.ball.netX - this.ball.x) * smooth;
      this.ball.y += (this.ball.netY - this.ball.y) * smooth;
      this.ball.z += (this.ball.netZ - this.ball.z) * smooth;
    }
    this._snapNextState = false;
    this._updateBallVisuals(dt);
  }

  // Loop Principale
  animate(time) {
    if (this.isDestroyed) return;
    this.rafId = requestAnimationFrame(this.animate);

    // Se in pausa, renderizza la scena ferma e non avanzare timer o logica
    if (this.isPaused) {
      this.renderer.render(this.scene, this.camera);
      this.lastTime = time;
      return;
    }

    const dt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    // 1. Processa input locale (tastiera, touch stick e buffer carica/rilascio)
    this.processInput(dt);

    // 2. Simulazione Autoritativa (Single Player o Host) vs Rendering Interpolato (Client Online)
    if (!this.options.isClient) {
      if (this.state === 'playing') {
        // Caricamento passivo Super Gauge stile Mario Strikers
        this.chargeMeter(1, dt * 2.8);
        this.chargeMeter(2, dt * 2.8);

        // Aggiorna timer partita
        this.matchTime = Math.max(0, this.matchTime - dt);
        if (this.matchTime <= 0) {
          this.state = 'ended';
          sounds.playWhistle(true);
          this.emitGameEvent({ event: 'match_end', score: [...this.score] });
          if (this.options.onMatchEnd) this.options.onMatchEnd(this.score);
        }

        // Aggiorna Squadra 1 (Host / Locale o Peer remoto o AI)
        this.playersTeam1.forEach((p, idx) => {
          const ctrl = this._getSeatController(1, idx);
          if (ctrl === 'local' || ctrl === 'host') {
            this.updatePlayer(p, this.input, dt);
          } else if (ctrl) {
            this.updatePlayer(p, this._getRemoteInputState(ctrl), dt);
          } else {
            this.updateAI(p, dt);
          }
        });

        // Aggiorna Squadra 2 (Host / Peer remoto / Multi-Peer o AI)
        this.playersTeam2.forEach((p, idx) => {
          const ctrl = this._getSeatController(2, idx);
          if (ctrl === 'local' || ctrl === 'host') {
            this.updatePlayer(p, this.input, dt);
          } else if (ctrl) {
            this.updatePlayer(p, this._getRemoteInputState(ctrl), dt);
          } else {
            this.updateAI(p, dt);
          }
        });

        // Aggiorna fisica palla
        this.updateBall(dt);

        // Reset triggers input (locale + tutti i peer remoti)
        this.input.shootTrigger = false;
        this.input.passTrigger = false;
        this.input.slideTrigger = false;
        this.remoteInput.shootTrigger = false;
        this.remoteInput.passTrigger = false;
        this.remoteInput.slideTrigger = false;
        this.remoteInputs.forEach(inp => {
          inp.shootTrigger = false;
          inp.passTrigger = false;
          inp.slideTrigger = false;
        });

      } else if (this.state === 'goal') {
        // Celebrazione del gol
        this.goalCelebrationTimer -= dt;
        this.updateBall(dt);

        // Fai esultare i giocatori della squadra che ha appena segnato il gol
        const celebratingTeam = (this.lastScoringTeam === 1) ? this.playersTeam1 : this.playersTeam2;
        celebratingTeam.forEach(p => {
          p.mesh.position.y = Math.abs(Math.sin(performance.now() * 0.008)) * 1.2;
        });

        if (this.goalCelebrationTimer <= 0) {
          // La squadra che ha subito gol batte il calcio d'inizio
          const nextKickoffTeam = (this.lastScoringTeam === 1) ? 2 : 1;
          this.resetKickoff(nextKickoffTeam);
        }
      }
    } else {
      // Modalità Client: consuma eventuali trigger locali residui e interpola lo stato dell'Host
      this.input.shootTrigger = false;
      this.input.passTrigger = false;
      this.input.slideTrigger = false;
      this.updateClientVisuals(dt);
    }

    // 3. Indicatori visivi di selezione e cartellini nomi 3D sopra la testa (Oro = Tu, Ciano/Corallo = Altri Umani)
    const renderTeamIndicators = (arr, teamNum, activeIdx) => {
      arr.forEach((p, idx) => {
        const isMine = (this.localTeam === teamNum) &&
          ((this.controlMode === '1v1') ? (idx === activeIdx) : (idx === this.localSlot));
        const isHuman = (this.controlMode === '1v1')
          ? ((idx === activeIdx) && (teamNum === 1 || !this.isSinglePlayer))
          : this._isSlotHumanControlled(teamNum, idx);
        const isOtherHuman = !isMine && isHuman;

        if (p.ringMat) {
          if (isMine) {
            p.ringMat.color.setHex(0xffd700);
            p.ringMat.opacity = 0.95;
          } else if (isOtherHuman) {
            p.ringMat.color.setHex(teamNum === this.localTeam ? 0x00f0ff : 0xff6b6b);
            p.ringMat.opacity = 0.55;
          } else {
            p.ringMat.opacity = 0;
          }
        }
        if (p.arrowMat) {
          p.arrowMat.opacity = (isMine && this.ball.holder === p)
            ? 0.95
            : ((isOtherHuman && this.ball.holder === p) ? 0.55 : 0);
        }
        if (p.nameTag) {
          const sX = (isMine ? 3.5 : (isOtherHuman ? 3.1 : 2.7)) * p.scale;
          const sY = (isMine ? 0.88 : (isOtherHuman ? 0.78 : 0.68)) * p.scale;
          p.nameTag.scale.set(sX, sY, 1);
          p.nameTag.position.y = 3.85 * p.scale;
        }
      });
    };

    renderTeamIndicators(this.playersTeam1, 1, this.activePlayerIdx1);
    renderTeamIndicators(this.playersTeam2, 2, this.activePlayerIdx2);

    // 4. Telecamera dinamica 2.5D Mario Strikers (insegue palla + orientamento verso giocatore fisso in 2v2/3v3)
    let focusX = this.ball.x * 0.45;
    let focusZ = this.ball.z * 0.38;
    let camHeight = 38;
    let camZOffset = 38;
    if (this.controlMode !== '1v1') {
      const localP = this._getLocalControlledPlayer();
      if (localP) {
        focusX = this.ball.x * 0.34 + localP.x * 0.14;
        focusZ = this.ball.z * 0.28 + localP.z * 0.12;
        camHeight = 41.5;
        camZOffset = 41;
      }
    }
    const targetCamX = focusX;
    const targetCamZ = focusZ + camZOffset;
    this.camera.position.x += (targetCamX - this.camera.position.x) * 3.5 * dt;
    this.camera.position.y += (camHeight - this.camera.position.y) * 2.5 * dt;
    this.camera.position.z += (targetCamZ - this.camera.position.z) * 3.5 * dt;
    this.camera.lookAt(focusX, 1.2, focusZ * 0.92);

    // Applicazione Camera Shake per impatto arcade
    if (this.cameraShake > 0.01) {
      const shakeX = (Math.random() - 0.5) * this.cameraShake * 1.8;
      const shakeY = (Math.random() - 0.5) * this.cameraShake * 1.2;
      this.camera.position.x += shakeX;
      this.camera.position.y += shakeY;
      this.cameraShake *= Math.pow(0.04, dt);
    } else {
      this.cameraShake = 0;
    }

    // 5. Render scena
    this.renderer.render(this.scene, this.camera);

    // Callback per aggiornamento HUD (Scoreboard, Timer, Minimappa, Super Gauge)
    if (this.options.onUpdateHUD) {
      const localP = this._getLocalControlledPlayer();
      this.options.onUpdateHUD({
        score: this.score,
        matchTime: Math.ceil(this.matchTime),
        ball: { x: this.ball.x, z: this.ball.z },
        hasBall: this.userTeamHasBall(),
        iHaveBall: this.localPlayerHasBall(),
        localRole: localP ? localP.role : 'fwd',
        controlMode: this.controlMode,
        localTeam: this.localTeam,
        p1: this.playersTeam1.map(p => ({ x: p.x, z: p.z, id: p.id, name: p.name })),
        p2: this.playersTeam2.map(p => ({ x: p.x, z: p.z, id: p.id, name: p.name })),
        shotPower: this.input.shotPower,
        specialMeter1: Math.floor(this.specialMeter1),
        specialMeter2: Math.floor(this.specialMeter2),
        specialReady1: this.specialMeter1 >= 100,
        specialReady2: this.specialMeter2 >= 100
      });
    }

    // Se Host online, serializza e invia stato ai peer a 30Hz (volatile)
    if (this.options.isHost && this.options.networkManager && this.options.networkManager.connected) {
      this._netSyncAccum += dt;
      if (this._netSyncAccum >= 0.033) {
        this._netSyncAccum = 0;
        this.sendNetworkState();
      }
    }
  }

  _computeHumanMask() {
    let mask = 0;
    for (let s = 0; s < 3; s++) {
      if (this._getSeatController(1, s)) mask |= (1 << s);
      if (this._getSeatController(2, s)) mask |= (1 << (3 + s));
    }
    return mask;
  }

  sendNetworkState() {
    const packet = {
      type: 'state',
      score: this.score,
      time: Math.ceil(this.matchTime),
      state: this.state,
      hm: this._computeHumanMask(),
      active1: this.activePlayerIdx1,
      active2: this.activePlayerIdx2,
      m1: Math.floor(this.specialMeter1),
      m2: Math.floor(this.specialMeter2),
      lst: this.lastScoringTeam || 0,
      shT: this.goalShieldTimer > 0 ? this.goalShieldTeam : 0,
      ball: {
        x: Number(this.ball.x.toFixed(2)),
        y: Number(this.ball.y.toFixed(2)),
        z: Number(this.ball.z.toFixed(2)),
        vx: Number((this.ball.vx || 0).toFixed(2)),
        vz: Number((this.ball.vz || 0).toFixed(2)),
        hT: this.ball.holder ? this.ball.holder.team : 0,
        hI: this.ball.holder ? this.ball.holder.index : -1,
        sp: !!this.ball.isSpecialShot,
        st: this.ball.specialType || ''
      },
      t1: this.playersTeam1.map(p => ({
        x: Number(p.x.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        rot: Number(p.rot.toFixed(2)),
        s: !!p.isSliding,
        ex: !!p.isExpelled
      })),
      t2: this.playersTeam2.map(p => ({
        x: Number(p.x.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        rot: Number(p.rot.toFixed(2)),
        s: !!p.isSliding,
        ex: !!p.isExpelled
      }))
    };
    this.options.networkManager.send(packet, true);
  }

  // Applica stato autoritativo se siamo il Client
  applyNetworkState(packet) {
    if (!packet || packet.type !== 'state') return;

    const firstPacket = (typeof this.ball.netX !== 'number');
    this.score = packet.score;
    this.matchTime = packet.time;
    this.state = packet.state;
    if (typeof packet.active1 === 'number') this.activePlayerIdx1 = packet.active1;
    if (typeof packet.active2 === 'number') this.activePlayerIdx2 = packet.active2;
    if (typeof packet.lst === 'number') this.lastScoringTeam = packet.lst;
    this.goalShieldTeam = packet.shT || 0;
    this.goalShieldTimer = this.goalShieldTeam ? 1.0 : 0;

    if (typeof packet.hm === 'number') this.humanControlMask = packet.hm;

    if (typeof packet.m1 === 'number') {
      this.specialMeter1 = packet.m1;
      if (this.localTeam === 1) {
        if (this.specialMeter1 >= 100 && !this.specialAudioPlayed1) {
          sounds.playSpecialReady();
          this.specialAudioPlayed1 = true;
        } else if (this.specialMeter1 < 100) {
          this.specialAudioPlayed1 = false;
        }
      }
    }
    if (typeof packet.m2 === 'number') {
      this.specialMeter2 = packet.m2;
      if (this.localTeam === 2) {
        if (this.specialMeter2 >= 100 && !this.specialAudioPlayed2) {
          sounds.playSpecialReady();
          this.specialAudioPlayed2 = true;
        } else if (this.specialMeter2 < 100) {
          this.specialAudioPlayed2 = false;
        }
      }
    }

    // Palla e portatore
    this.ball.netX = packet.ball.x;
    this.ball.netY = packet.ball.y;
    this.ball.netZ = packet.ball.z;
    this.ball.vx = packet.ball.vx || 0;
    this.ball.vz = packet.ball.vz || 0;
    this.ball.isSpecialShot = !!packet.ball.sp;
    this.ball.specialType = packet.ball.st || null;

    if (firstPacket || this._snapNextState) {
      this.ball.x = packet.ball.x;
      this.ball.y = packet.ball.y;
      this.ball.z = packet.ball.z;
      this.ballMesh.position.set(this.ball.x, this.ball.y, this.ball.z);
      this.ballShadow.position.set(this.ball.x, 0.02, this.ball.z);
    }

    const holderTeam = packet.ball.hT || 0;
    const holderIdx = (typeof packet.ball.hI === 'number') ? packet.ball.hI : -1;
    if (holderTeam === 1 && holderIdx >= 0 && this.playersTeam1[holderIdx]) {
      this.ball.holder = this.playersTeam1[holderIdx];
    } else if (holderTeam === 2 && holderIdx >= 0 && this.playersTeam2[holderIdx]) {
      this.ball.holder = this.playersTeam2[holderIdx];
    } else {
      this.ball.holder = null;
    }

    const syncNetTeam = (arr, dataList) => {
      if (!Array.isArray(dataList)) return;
      dataList.forEach((data, idx) => {
        const p = arr[idx];
        if (!p) return;
        p.netX = data.x;
        p.netZ = data.z;
        p.netRot = data.rot;
        p.isSliding = !!data.s;
        p.isExpelled = !!data.ex;
        if (firstPacket || this._snapNextState) {
          p.x = data.x;
          p.z = data.z;
          p.rot = data.rot;
          p.mesh.position.set(p.x, 0, p.z);
          p.mesh.rotation.y = p.rot;
        }
      });
    };

    syncNetTeam(this.playersTeam1, packet.t1);
    syncNetTeam(this.playersTeam2, packet.t2);
  }
}
