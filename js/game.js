// Motore di Gioco 2.5D Calcio con Three.js
import { CHARACTERS, getCharacterById } from './characters.js';
import { sounds } from './audio.js';

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

    // Input locale
    this.input = {
      moveX: 0,
      moveZ: 0,
      sprint: false,
      isChargingShot: false,
      shotPower: 0,
      shootTrigger: false,
      shotBufferTimer: 0,
      passTrigger: false,
      slideTrigger: false,
      switchTrigger: false
    };

    // Client remote input (se Host online)
    this.remoteInput = {
      moveX: 0,
      moveZ: 0,
      sprint: false,
      isChargingShot: false,
      shotPower: 0,
      shootTrigger: false,
      shotBufferTimer: 0,
      passTrigger: false,
      slideTrigger: false,
      switchTrigger: false
    };

    // Giocatore controllato attivamente
    this.activePlayerIdx1 = 0;
    this.activePlayerIdx2 = 0;

    // Setup Three.js
    this.initThree();
    this.createStadium();
    this.createBall();
    this.spawnPlayers();
    this.setupEventListeners();

    this.lastTime = performance.now();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initThree() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.scene = new window.THREE.Scene();
    this.scene.background = new window.THREE.Color(0x131e29);
    this.scene.fog = new window.THREE.FogExp2(0x131e29, 0.007);

    // Camera 2.5D Più ampia e panoramica per una visuale tattica
    this.camera = new window.THREE.PerspectiveCamera(46, width / height, 0.1, 1000);
    this.camera.position.set(0, 52, 58);
    this.camera.lookAt(0, 0, 0);

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
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Sfondo badge a capsula arrotondata (scuro semitrasparente ad alto contrasto)
    const x = 12, y = 8, w = 232, h = 48, r = 24;
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
    ctx.fillStyle = 'rgba(8, 16, 28, 0.88)';
    ctx.fill();

    const isTeam1 = (teamColor === 0xe74c3c);

    if (isAraChar) {
      // Badge Oro speciale per Ara
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffd700';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(38, 32, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd700';
      ctx.fill();

      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 28px "Rajdhani", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🦅 ARA 🦅', 142, 33);
    } else {
      // Bordo identificativo con colore della squadra
      ctx.lineWidth = 4;
      ctx.strokeStyle = isTeam1 ? '#ff3838' : '#00f0ff';
      ctx.stroke();

      // Pallino squadra a sinistra
      ctx.beginPath();
      ctx.arc(38, 32, 8, 0, Math.PI * 2);
      ctx.fillStyle = isTeam1 ? '#ff3838' : '#00f0ff';
      ctx.fill();

      // Nome del giocatore in grassetto con icona abilità
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px "Rajdhani", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const displayName = icon ? `${icon} ${name.toUpperCase()}` : name.toUpperCase();
      ctx.fillText(displayName, 142, 33);
    }

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

    // 1. Corpo / Maglia
    const torsoGeo = new window.THREE.CylinderGeometry(0.55 * scale, 0.45 * scale, 1.1 * scale, 16);
    const torsoMat = new window.THREE.MeshStandardMaterial({
      color: teamColor,
      roughness: 0.4
    });
    const torso = new window.THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.05 * scale;
    torso.castShadow = true;
    root.add(torso);

    // Pantaloncini
    const shortsGeo = new window.THREE.CylinderGeometry(0.48 * scale, 0.45 * scale, 0.45 * scale, 16);
    const shortsMat = new window.THREE.MeshStandardMaterial({ color: 0x1e272e, roughness: 0.5 });
    const shorts = new window.THREE.Mesh(shortsGeo, shortsMat);
    shorts.position.y = 0.55 * scale;
    shorts.castShadow = true;
    root.add(shorts);

    // 2. Testa
    const headGeo = new window.THREE.SphereGeometry(0.48 * scale, 16, 16);
    const skinHex = parseInt(charData.skinColor.replace('#', '0x')) || 0xf1c27d;
    const headMat = new window.THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.7 });
    const head = new window.THREE.Mesh(headGeo, headMat);
    head.position.y = 1.95 * scale;
    head.castShadow = true;
    root.add(head);

    // 2b. Sprite Volto Foto Personalizzato (per Ara e avatar speciali)
    if (charData.id === 'ara' || charData.avatar) {
      const loader = new window.THREE.TextureLoader();
      const faceTex = loader.load(charData.avatar || 'assets/ara_avatar.png');
      const faceMat = new window.THREE.SpriteMaterial({
        map: faceTex,
        transparent: true,
        depthTest: true
      });
      const faceSprite = new window.THREE.Sprite(faceMat);
      faceSprite.position.set(0, 2.05 * scale, 0);
      faceSprite.scale.set(1.45 * scale, 1.45 * scale, 1);
      root.add(faceSprite);
    }

    // 3. Capelli personalizzati
    const hairHex = parseInt(charData.hairColor.replace('#', '0x')) || 0x222222;
    const hairMat = new window.THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.9 });

    if (charData.hairStyle === 'afro') {
      const afroGeo = new window.THREE.SphereGeometry(0.58 * scale, 16, 16);
      const afro = new window.THREE.Mesh(afroGeo, hairMat);
      afro.position.set(0, 2.05 * scale, -0.05);
      root.add(afro);
    } else if (charData.hairStyle === 'mohawk') {
      const hawkGeo = new window.THREE.BoxGeometry(0.18 * scale, 0.4 * scale, 0.7 * scale);
      const hawk = new window.THREE.Mesh(hawkGeo, hairMat);
      hawk.position.set(0, 2.4 * scale, 0);
      root.add(hawk);
    } else if (charData.hairStyle === 'ponytail') {
      const hairGeo = new window.THREE.SphereGeometry(0.49 * scale, 14, 14);
      const hair = new window.THREE.Mesh(hairGeo, hairMat);
      hair.position.set(0, 2.02 * scale, 0);
      root.add(hair);
      const tailGeo = new window.THREE.CylinderGeometry(0.15 * scale, 0.05 * scale, 0.6 * scale, 8);
      const tail = new window.THREE.Mesh(tailGeo, hairMat);
      tail.position.set(0, 1.85 * scale, -0.5 * scale);
      tail.rotation.x = -Math.PI / 3;
      root.add(tail);
    } else {
      // Standard / Spiky / Buzz
      const hairGeo = new window.THREE.CylinderGeometry(0.52 * scale, 0.5 * scale, 0.28 * scale, 14);
      const hair = new window.THREE.Mesh(hairGeo, hairMat);
      hair.position.y = 2.22 * scale;
      root.add(hair);
    }

    // Fascia o capitano
    if (charData.hairStyle === 'headband' || isCaptain) {
      const bandGeo = new window.THREE.CylinderGeometry(0.5 * scale, 0.5 * scale, 0.12 * scale, 16);
      const bandMat = new window.THREE.MeshBasicMaterial({ color: 0xffdd00 });
      const band = new window.THREE.Mesh(bandGeo, bandMat);
      band.position.y = 2.05 * scale;
      root.add(band);
    }

    // 4. Ombra a terra del giocatore
    const shadowGeo = new window.THREE.CircleGeometry(0.75 * scale, 16);
    const shadowMat = new window.THREE.MeshBasicMaterial({ color: 0x051206, transparent: true, opacity: 0.5 });
    const shadow = new window.THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    root.add(shadow);

    // 5. Anello di selezione (indicatore sotto i piedi per il giocatore attivo)
    const ringGeo = new window.THREE.RingGeometry(0.85 * scale, 1.15 * scale, 32);
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
    arrow.position.set(0, 0.05, 1.5 * scale);
    root.add(arrow);

    // 7. Cartellino nome giocatore in 3D fluttuante sopra la testa
    const nameTag = this.createNameTag(charData, teamColor, charData.id === 'ara');
    nameTag.position.set(0, 3.1 * scale, 0);
    nameTag.scale.set(3.4, 0.85, 1);
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
        cannotPickupTimer: 0
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
        cannotPickupTimer: 0
      };
      meshData.root.position.set(p.x, 0, p.z);
      meshData.root.rotation.y = Math.PI;
      this.scene.add(meshData.root);
      this.playersTeam2.push(p);
    });

    this.allPlayers = [...this.playersTeam1, ...this.playersTeam2];
  }

  // Verifica se la squadra dell'utente ha il possesso del pallone
  userTeamHasBall() {
    const userTeamNum = this.options.isClient ? 2 : 1;
    return (this.ball.holder && this.ball.holder.team === userTeamNum);
  }

  setupEventListeners() {
    // Gestione tastiera
    this.keysDown = {};

    window.addEventListener('keydown', (e) => {
      this.keysDown[e.code] = true;

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
        const myTeam = this.options.isClient ? 2 : 1;
        this.triggerSpecial(myTeam);
        e.preventDefault();
      }

      // Tasti di Tiro: X, K, C, V, Invio
      const isShootKey = (e.code === 'KeyX' || e.code === 'KeyK' || e.code === 'KeyC' || e.code === 'KeyV' || e.code === 'Enter');

      // Tasti di Passaggio: Z, J, B
      if (e.code === 'KeyZ' || e.code === 'KeyJ' || e.code === 'KeyB') {
        this.input.passTrigger = true;
      }

      // Spazio: se la nostra squadra ha la palla, TIRO! Altrimenti cambia giocatore attivo!
      if (e.code === 'Space') {
        if (this.userTeamHasBall()) {
          this.input.isChargingShot = true;
          this.input.shotPower = Math.max(this.input.shotPower, 0.45);
        } else {
          this.input.switchTrigger = true;
        }
        e.preventDefault();
      }

      // Q: sempre cambio giocatore manuale
      if (e.code === 'KeyQ') {
        this.input.switchTrigger = true;
        e.preventDefault();
      }

      // Se premi uno dei tasti di tiro (X, K, C, V, Invio)
      if (isShootKey) {
        this.input.isChargingShot = true;
        this.input.shotPower = Math.max(this.input.shotPower, 0.45);

        // Se non abbiamo palla e siamo lontani, tenta scivolata
        if (!this.userTeamHasBall()) {
          this.input.slideTrigger = true;
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown[e.code] = false;

      const isShootKey = (e.code === 'KeyX' || e.code === 'KeyK' || e.code === 'KeyC' || e.code === 'KeyV' || e.code === 'Enter' || e.code === 'Space');

      // Rilascio del tasto di tiro: spara immediatamente il tiro!
      if (isShootKey && this.input.isChargingShot) {
        this.input.isChargingShot = false;
        this.input.shootTrigger = true;
        this.input.shotBufferTimer = 0.45; // Finestra buffer di 450ms per colpire
      }
    });

    // Supporto Click del Mouse per calciare
    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('.interactive') || e.target.tagName === 'BUTTON') return;
      this.input.isChargingShot = true;
      this.input.shotPower = Math.max(this.input.shotPower, 0.45);
      if (!this.userTeamHasBall()) {
        this.input.slideTrigger = true;
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.input.isChargingShot) {
        this.input.isChargingShot = false;
        this.input.shootTrigger = true;
        this.input.shotBufferTimer = 0.45;
      }
    });

    // Resize finestra
    window.addEventListener('resize', () => {
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  // Riceve input dal giocatore remoto (se partita online)
  setRemoteInput(inputData) {
    this.remoteInput = { ...this.remoteInput, ...inputData };
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
    });

    this.playersTeam2.forEach(p => {
      p.x = p.baseX;
      p.z = p.baseZ;
      p.vx = 0;
      p.vz = 0;
      p.isSliding = false;
    });

    // Chi batte riceve la palla vicino
    if (concedingTeam === 1) {
      // Batte Team 1
      this.playersTeam1[2].x = -1.5;
      this.playersTeam1[2].z = 0;
    } else {
      // Batte Team 2
      this.playersTeam2[2].x = 1.5;
      this.playersTeam2[2].z = 0;
    }

    this.state = 'playing';
    sounds.playWhistle(false);
  }

  // Gestione Pausa
  togglePause() {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  setPause(paused) {
    this.isPaused = paused;
  }

  // Switch al compagno più vicino alla palla
  switchActivePlayer(teamNum) {
    const team = (teamNum === 1) ? this.playersTeam1 : this.playersTeam2;
    let closestIdx = 0;
    let minDist = 99999;

    team.forEach((p, idx) => {
      const dx = p.x - this.ball.x;
      const dz = p.z - this.ball.z;
      const dist = Math.hypot(dx, dz);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    });

    if (teamNum === 1) {
      this.activePlayerIdx1 = closestIdx;
    } else {
      this.activePlayerIdx2 = closestIdx;
    }
    sounds.playBeep(750, 0.05);
  }

  // Aggiorna input da tastiera
  processInput(dt) {
    let mx = 0;
    let mz = 0;

    if (this.keysDown['ArrowLeft'] || this.keysDown['KeyA']) mx -= 1;
    if (this.keysDown['ArrowRight'] || this.keysDown['KeyD']) mx += 1;
    if (this.keysDown['ArrowUp'] || this.keysDown['KeyW']) mz -= 1;
    if (this.keysDown['ArrowDown'] || this.keysDown['KeyS']) mz += 1;

    // Normalizza direzione
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      this.input.moveX = mx / len;
      this.input.moveZ = mz / len;
    } else {
      this.input.moveX = 0;
      this.input.moveZ = 0;
    }

    this.input.sprint = !!(this.keysDown['ShiftLeft'] || this.keysDown['ShiftRight']);

    // Decrementa finestra buffer tiro
    if (this.input.shotBufferTimer > 0) {
      this.input.shotBufferTimer -= dt;
    }

    // Caricamento tiro (tenendo premuto aumenta, ma un tocco rapido ha già potenza minima)
    if (this.input.isChargingShot) {
      this.input.shotPower = Math.min(1.0, this.input.shotPower + dt * 1.5);
    } else if (!this.input.shootTrigger && (!this.input.shotBufferTimer || this.input.shotBufferTimer <= 0)) {
      this.input.shotPower = 0;
    }
  }

  // Aggiorna stato di un giocatore
  updatePlayer(p, inputData, dt) {
    const stats = p.charData;
    const isHuman = (p.team === 1 && !this.options.isClient && p.index === this.activePlayerIdx1) ||
                    (p.team === 2 && this.options.isClient && p.index === this.activePlayerIdx2);

    if (p.protectionTimer > 0) p.protectionTimer -= dt;
    if (p.tackleCooldown > 0) p.tackleCooldown -= dt;
    if (p.cannotPickupTimer > 0) p.cannotPickupTimer -= dt;

    const baseSpeed = 8.5 + (stats.speed / 100) * 3.5; // Velocità calibrata e controllabile (8.5 - 12.0 unità/sec)
    // Il giocatore umano ha uno sprint reattivo (1.35x), mentre la CPU mantiene un passo più rilassato (82%)
    const speedMult = inputData.sprint ? (isHuman ? 1.35 : 1.1) : 1.0;
    const paceFactor = isHuman ? 1.0 : 0.82;
    const currentMaxSpeed = baseSpeed * speedMult * paceFactor;

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
      if (distBall < 2.0 * p.scale && this.ball.holder !== p) {
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

    // Trigger contrasto: Spallata fisica (Mario Strikers Body Check) da vicino o Scivolata in corsa
    if (inputData.slideTrigger && !p.isSliding) {
      const enemyCarrier = (this.ball.holder && this.ball.holder.team !== p.team) ? this.ball.holder : null;
      const distToCarrier = enemyCarrier ? Math.hypot(p.x - enemyCarrier.x, p.z - enemyCarrier.z) : 999;

      if (enemyCarrier && distToCarrier < 2.0 * p.scale && p.tackleCooldown <= 0) {
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
      if (distToCarrier < 1.45 * p.scale && carrier.protectionTimer <= 0 && p.tackleCooldown <= 0) {
        p.tackleCooldown = 0.5;
        // Probabilità di vincere il contrasto in base a stat tackle e tempo in cui l'avversario trattiene palla
        const tackleChance = 0.52 + (stats.tackle / 240) + Math.min(0.35, carrier.possessionTime * 0.2);
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

          // Auto-switch se la palla viene rubata da un compagno della squadra dell'utente
          const userTeam = this.options.isClient ? 2 : 1;
          if (p.team === userTeam) {
            if (this.options.isClient) {
              this.activePlayerIdx2 = p.index;
            } else {
              this.activePlayerIdx1 = p.index;
            }
          }
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
      // Esegui passaggio corto o filtrante / cross
      else if (inputData.passTrigger) {
        const teammates = (p.team === 1) ? this.playersTeam1 : this.playersTeam2;
        const otherTeammates = teammates.filter(mate => mate !== p);

        // Trova compagno migliore da servire
        let bestTarget = otherTeammates[0];
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

        // Auto-switch immediato al ricevitore se il passaggio è della squadra utente
        const userTeam = this.options.isClient ? 2 : 1;
        if (p.team === userTeam) {
          if (this.options.isClient) {
            this.activePlayerIdx2 = bestTarget.index;
          } else {
            this.activePlayerIdx1 = bestTarget.index;
          }
        }
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

      // Controlla intercetto / aggancio palla vagante
      const pickupRadius = (isHuman ? 1.6 : 1.25) * p.scale;
      if (distToBall < pickupRadius && this.ball.y < 2.0 && !this.ball.holder && (!p.cannotPickupTimer || p.cannotPickupTimer <= 0)) {
        this.ball.holder = p;
        this.ball.lastPossessor = p;
        this.ball.isSpecialShot = false;
        p.possessionTime = 0;
        p.protectionTimer = 0.35; // 0.35s di protezione iniziale
        sounds.playKick(0.4);

        // AUTO-SWITCH: se un compagno della squadra dell'utente prende la palla, passa subito il controllo a lui!
        const userTeam = this.options.isClient ? 2 : 1;
        if (p.team === userTeam) {
          if (this.options.isClient) {
            this.activePlayerIdx2 = p.index;
          } else {
            this.activePlayerIdx1 = p.index;
          }
        }
      }
    }
  }

  // Intelligenza Artificiale Calibrata (Intelligente ma più passiva, lasciando il pieno controllo al giocatore)
  updateAI(p, dt) {
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

    const isUserTeam = (p.team === (this.options.isClient ? 2 : 1));
    const activeUserIdx = this.options.isClient ? this.activePlayerIdx2 : this.activePlayerIdx1;
    const humanPlayer = isUserTeam ? myTeam[activeUserIdx] : oppTeam[activeUserIdx];

    const distToBall = Math.hypot(p.x - this.ball.x, p.z - this.ball.z);
    const hasBall = (this.ball.holder === p);

    // ============================================
    // 1. IL GIOCATORE AI HA LA PALLA
    // ============================================
    if (hasBall) {
      if (isUserTeam) {
        // Compagno di squadra dell'utente ha la palla: cerca passaggio all'utente o avanza
        const distToHuman = Math.hypot(p.x - humanPlayer.x, p.z - humanPlayer.z);
        if (p !== humanPlayer && distToHuman < 26 && Math.random() < 0.04) {
          aiInput.passTrigger = true;
        } else {
          const dx = targetGoalX - p.x;
          const dz = -p.z * 0.35;
          const len = Math.hypot(dx, dz);
          aiInput.moveX = dx / len;
          aiInput.moveZ = dz / len;
        }
      } else {
        // CPU avversaria ha la palla: avanza a passo controllato (senza sprintare)
        const distToGoal = Math.abs(targetGoalX - p.x);

        // Tira SOLO se molto vicina alla porta (< 15 metri) e centrale, dopo aver controllato la palla
        if (this.isSinglePlayer && this.specialMeter2 >= 100 && distToGoal < 28 && p.possessionTime > 0.6 && Math.random() < 0.05) {
          this.triggerSpecial(2);
        } else if (distToGoal < 15 && Math.abs(p.z) < 9 && p.possessionTime > 0.8) {
          aiInput.shootTrigger = true;
          aiInput.shotPower = 0.55 + Math.random() * 0.25;
        } else {
          // Avanza verso la porta a passo moderato
          const dirX = targetGoalX - p.x;
          const dirZ = -p.z * 0.3;
          const len = Math.hypot(dirX, dirZ);
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
      const humanDistToBall = Math.hypot(humanPlayer.x - this.ball.x, humanPlayer.z - this.ball.z);

      if (isUserTeam) {
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
          // Trova il giocatore CPU di movimento più vicino alla palla
          let closestCpu = myTeam[0];
          let minCpuDist = 9999;
          myTeam.forEach(cp => {
            const d = Math.hypot(cp.x - this.ball.x, cp.z - this.ball.z);
            if (d < minCpuDist) { minCpuDist = d; closestCpu = cp; }
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
        let closestDefender = myTeam[0];
        let minDefDist = 9999;
        myTeam.forEach(cp => {
          if (cp.role !== 'gk') {
            const d = Math.hypot(cp.x - holder.x, cp.z - holder.z);
            if (d < minDefDist) { minDefDist = d; closestDefender = cp; }
          }
        });

        if (p === closestDefender) {
          // DIFENSORE PRIMARIO:
          // Va incontro al portatore per chiudergli la strada e rubare palla!
          const dx = holder.x - p.x;
          const dz = holder.z - p.z;
          const dist = Math.hypot(dx, dz);

          if (dist > 0.5) {
            aiInput.moveX = dx / dist;
            aiInput.moveZ = dz / dist;
          }

          // Se il portatore ha la palla da oltre 0.4s ed è a distanza di tackle (< 1.6m):
          if (dist < 1.6 && holder.possessionTime > 0.4 && p.tackleCooldown <= 0) {
            // Esegue scivolata difensiva se è in corsa o ad angolo
            if (Math.random() < 0.12) {
              aiInput.slideTrigger = true;
              p.tackleCooldown = 1.8;
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
  triggerSpecial(teamNum) {
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
    const player = (teamNum === 1) ? this.playersTeam1[activeIdx] : this.playersTeam2[activeIdx];
    const char = player.charData;

    // Cut-in Cinematic Mario Strikers
    if (this.options.onSpecialTrigger) {
      this.options.onSpecialTrigger({ player, charData: char });
    }

    // Effetti Sonori Dedicati
    sounds.playSpecialStrike(char.specialType);
    if (char.id === 'ara') {
      sounds.playEagleCry();
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

      case 'ento': { // CANNONE INFUOCATO
        const dx = targetGoalX - player.x;
        const dz = 0 - player.z;
        const dist = Math.hypot(dx, dz) || 1;
        this.ball.x = player.x + (dx / dist) * 1.5;
        this.ball.z = player.z + (dz / dist) * 1.5;
        this.ball.y = 1.4;
        this.ball.vx = (dx / dist) * 42;
        this.ball.vz = (dz / dist) * 42;
        this.ball.vy = 3.6;
        this.ball.isSpecialShot = true;
        this.ball.specialType = 'fire_cannon';
        this.ball.specialShooter = player;
        this.ball.lastShooter = player;
        this.ball.lastKicker = player;
        break;
      }

      case 'bubi':
      case 'jona': { // TACKLE TERREMOTO / CARICA DEL GLADIATORE
        oppTeam.forEach(opp => {
          const d = Math.hypot(opp.x - player.x, opp.z - player.z);
          if (d < 15) {
            opp.isSliding = true;
            opp.slideTimer = 2.0;
            opp.cannotPickupTimer = 2.0;
            opp.protectionTimer = 0;
            opp.vx = Math.sign(opp.x - player.x || 1) * 12;
            opp.vz = Math.sign(opp.z - player.z || 1) * 12;
          }
        });
        this.ball.holder = player;
        player.protectionTimer = 1.5;
        sounds.playSlide();
        break;
      }

      case 'matti': { // SCATTO FULMINEO
        player.stamina = 100;
        player.cannotPickupTimer = 0;
        this.ball.holder = player;
        player.protectionTimer = 2.0;
        player.vx = Math.sign(targetGoalX - player.x) * 22;
        break;
      }

      case 'jelmo': { // MURO INVALICABILE
        this.goalShieldTeam = teamNum;
        this.goalShieldTimer = 10.0;
        sounds.playWhistle(false);
        break;
      }

      default: { // Altri tiri speciali (Lollo, Roby, Pibe, Kri, Leon, Lindi)
        const targetZ = (Math.random() > 0.5 ? 3.5 : -3.5);
        const dx = targetGoalX - player.x;
        const dz = targetZ - player.z;
        const dist = Math.hypot(dx, dz) || 1;
        this.ball.x = player.x + (dx / dist) * 1.5;
        this.ball.z = player.z + (dz / dist) * 1.5;
        this.ball.y = 1.2;
        const pwr = 36;
        this.ball.vx = (dx / dist) * pwr;
        this.ball.vz = (dz / dist) * pwr + (char.id === 'lollo' ? 8 : 0);
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

    // Rotazione visiva palla
    const speed = Math.hypot(this.ball.vx, this.ball.vz);
    this.ball.rotX += speed * dt * 2;
    this.ballMesh.rotation.x = this.ball.rotX;
    this.ballMesh.rotation.z += this.ball.vx * dt * 2;

    // Aggiorna scia luminosa ad alta velocità / super tiro
    if (this.ballTrail && this.ballTrail.length > 0) {
      const showTrail = (speed > 18 || this.ball.isSpecialShot);
      if (showTrail) {
        for (let i = this.ballTrail.length - 1; i > 0; i--) {
          this.ballTrail[i].mesh.position.copy(this.ballTrail[i - 1].mesh.position);
          this.ballTrail[i].mesh.visible = true;
          this.ballTrail[i].mat.opacity = (1 - (i / this.ballTrail.length)) * 0.65;
          if (this.ball.isSpecialShot) {
            this.ballTrail[i].mat.color.setHex(0xffaa00);
          } else {
            this.ballTrail[i].mat.color.setHex(0x00f0ff);
          }
        }
        this.ballTrail[0].mesh.position.set(this.ball.x, this.ball.y, this.ball.z);
        this.ballTrail[0].mesh.visible = true;
        this.ballTrail[0].mat.opacity = 0.75;
        this.ballTrail[0].mat.color.setHex(this.ball.isSpecialShot ? 0xffdd00 : 0x00ffff);
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
  }

  // Loop Principale
  animate(time) {
    requestAnimationFrame(this.animate);

    // Se in pausa, renderizza la scena ferma e non avanzare timer o logica
    if (this.isPaused) {
      this.renderer.render(this.scene, this.camera);
      this.lastTime = time;
      return;
    }

    const dt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    // 1. Processa input locale
    this.processInput(dt);

    if (this.input.switchTrigger) {
      const myTeam = this.options.isClient ? 2 : 1;
      this.switchActivePlayer(myTeam);
      this.input.switchTrigger = false;
    }

    // 2. Se in partita attiva
    if (this.state === 'playing') {
      // Caricamento passivo Super Gauge stile Mario Strikers
      this.chargeMeter(1, dt * 2.8);
      this.chargeMeter(2, dt * 2.8);

      // Aggiorna timer partita
      this.matchTime = Math.max(0, this.matchTime - dt);
      if (this.matchTime <= 0) {
        this.state = 'ended';
        sounds.playWhistle(true);
        if (this.options.onMatchEnd) this.options.onMatchEnd(this.score);
      }

      // Aggiorna Squadra 1
      this.playersTeam1.forEach((p, idx) => {
        if (!this.options.isClient && idx === this.activePlayerIdx1) {
          // Controllato dal giocatore locale P1
          this.updatePlayer(p, this.input, dt);
        } else {
          // AI per compagni
          this.updateAI(p, dt);
        }
      });

      // Aggiorna Squadra 2
      this.playersTeam2.forEach((p, idx) => {
        if (this.options.isClient && idx === this.activePlayerIdx2) {
          // Se siamo il client remoto, controlliamo P2
          this.updatePlayer(p, this.input, dt);
        } else if (!this.isSinglePlayer && idx === this.activePlayerIdx2) {
          // Online Host: riceve input remoto per P2
          this.updatePlayer(p, this.remoteInput, dt);
        } else {
          // AI per compagni o CPU
          this.updateAI(p, dt);
        }
      });

      // Aggiorna fisica palla
      this.updateBall(dt);

      // Reset triggers input
      this.input.shootTrigger = false;
      this.input.passTrigger = false;
      this.input.slideTrigger = false;
      this.remoteInput.shootTrigger = false;
      this.remoteInput.passTrigger = false;
      this.remoteInput.slideTrigger = false;

    } else if (this.state === 'goal') {
      // Celebrazione del gol
      this.goalCelebrationTimer -= dt;
      this.updateBall(dt);

      // Fai saltare i giocatori della squadra vincente
      const celebratingTeam = (this.score[0] > this.score[1]) ? this.playersTeam1 : this.playersTeam2;
      celebratingTeam.forEach(p => {
        p.mesh.position.y = Math.abs(Math.sin(performance.now() * 0.008)) * 1.2;
      });

      if (this.goalCelebrationTimer <= 0) {
        const nextKickoffTeam = (this.score[0] > this.score[1]) ? 2 : 1;
        this.resetKickoff(nextKickoffTeam);
      }
    }

    // 3. Indicatori visivi di selezione e cartellini nomi 3D sopra la testa
    const activeIdx1 = this.activePlayerIdx1;
    this.playersTeam1.forEach((p, idx) => {
      const isActive = (idx === activeIdx1);
      p.ringMat.opacity = isActive ? 0.85 : 0;
      p.arrowMat.opacity = (isActive && this.ball.holder === p) ? 0.9 : 0;
      if (p.nameTag) {
        const sX = isActive ? 4.0 : 3.2;
        const sY = isActive ? 1.0 : 0.8;
        p.nameTag.scale.set(sX, sY, 1);
      }
    });

    const activeIdx2 = this.activePlayerIdx2;
    this.playersTeam2.forEach((p, idx) => {
      const isActive = (idx === activeIdx2);
      p.ringMat.opacity = isActive ? 0.85 : 0;
      p.arrowMat.opacity = (isActive && this.ball.holder === p) ? 0.9 : 0;
      if (p.nameTag) {
        const sX = isActive ? 4.0 : 3.2;
        const sY = isActive ? 1.0 : 0.8;
        p.nameTag.scale.set(sX, sY, 1);
      }
    });

    // 4. Telecamera dinamica 2.5D (insegue dolcemente la palla con visuale panoramica chiara)
    const targetCamX = this.ball.x * 0.35;
    const targetCamZ = this.ball.z * 0.28 + 50;
    this.camera.position.x += (targetCamX - this.camera.position.x) * 3.0 * dt;
    this.camera.position.z += (targetCamZ - this.camera.position.z) * 3.0 * dt;
    this.camera.lookAt(this.ball.x * 0.35, 0, this.ball.z * 0.28);

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
      this.options.onUpdateHUD({
        score: this.score,
        matchTime: Math.ceil(this.matchTime),
        ball: { x: this.ball.x, z: this.ball.z },
        hasBall: this.userTeamHasBall(),
        p1: this.playersTeam1.map(p => ({ x: p.x, z: p.z, id: p.id, name: p.name })),
        p2: this.playersTeam2.map(p => ({ x: p.x, z: p.z, id: p.id, name: p.name })),
        shotPower: this.input.shotPower,
        specialMeter1: Math.floor(this.specialMeter1),
        specialMeter2: Math.floor(this.specialMeter2),
        specialReady1: this.specialMeter1 >= 100,
        specialReady2: this.specialMeter2 >= 100
      });
    }

    // Se Host online, serializza e invia stato al peer
    if (this.options.isHost && this.options.networkManager && this.options.networkManager.connected) {
      this.sendNetworkState();
    }
  }

  sendNetworkState() {
    const packet = {
      type: 'state',
      score: this.score,
      time: Math.ceil(this.matchTime),
      state: this.state,
      ball: {
        x: Number(this.ball.x.toFixed(2)),
        y: Number(this.ball.y.toFixed(2)),
        z: Number(this.ball.z.toFixed(2)),
        holderTeam: this.ball.holder ? this.ball.holder.team : 0,
        holderIdx: this.ball.holder ? this.ball.holder.index : -1
      },
      t1: this.playersTeam1.map(p => ({
        x: Number(p.x.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        rot: Number(p.rot.toFixed(2)),
        sliding: p.isSliding
      })),
      t2: this.playersTeam2.map(p => ({
        x: Number(p.x.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        rot: Number(p.rot.toFixed(2)),
        sliding: p.isSliding
      }))
    };
    this.options.networkManager.send(packet);
  }

  // Applica stato autoritativo se siamo il Client
  applyNetworkState(packet) {
    if (!packet || packet.type !== 'state') return;

    this.score = packet.score;
    this.matchTime = packet.time;
    this.state = packet.state;

    // Palla
    this.ball.x = packet.ball.x;
    this.ball.y = packet.ball.y;
    this.ball.z = packet.ball.z;
    this.ballMesh.position.set(this.ball.x, this.ball.y, this.ball.z);
    this.ballShadow.position.set(this.ball.x, 0.02, this.ball.z);

    // Giocatori Squadra 1
    packet.t1.forEach((data, idx) => {
      const p = this.playersTeam1[idx];
      if (p) {
        p.x += (data.x - p.x) * 0.5;
        p.z += (data.z - p.z) * 0.5;
        p.rot = data.rot;
        p.isSliding = data.sliding;
      }
    });

    // Giocatori Squadra 2 (tranne il giocatore controllato localmente per predizione immediata)
    packet.t2.forEach((data, idx) => {
      const p = this.playersTeam2[idx];
      if (p && idx !== this.activePlayerIdx2) {
        p.x += (data.x - p.x) * 0.5;
        p.z += (data.z - p.z) * 0.5;
        p.rot = data.rot;
        p.isSliding = data.sliding;
      }
    });
  }
}
