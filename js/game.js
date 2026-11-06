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
    this.matchTime = 180; // 3 minuti in secondi
    this.state = 'waiting'; // waiting, playing, goal, ended
    this.goalCelebrationTimer = 0;
    this.isSinglePlayer = options.isSinglePlayer !== false;

    // Squadre (3 personaggi per squadra)
    this.team1Ids = options.team1 || ['ento', 'lindi', 'bubi'];
    this.team2Ids = options.team2 || ['pibe', 'matti', 'jelmo'];

    // Input locale
    this.input = {
      moveX: 0,
      moveZ: 0,
      sprint: false,
      isChargingShot: false,
      shotPower: 0,
      shootTrigger: false,
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

    // Camera 2.5D Isometrica / Broadcast
    this.camera = new window.THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(0, 48, 52);
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

    // Dati fisici palla
    this.ball = {
      x: 0,
      y: ballRadius,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      radius: ballRadius,
      rotX: 0,
      rotZ: 0,
      holder: null // player in possesso
    };
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

    return { root, ring, ringMat, arrow, arrowMat, scale };
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
        kickAnim: 0
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
        kickAnim: 0
      };
      meshData.root.position.set(p.x, 0, p.z);
      meshData.root.rotation.y = Math.PI;
      this.scene.add(meshData.root);
      this.playersTeam2.push(p);
    });

    this.allPlayers = [...this.playersTeam1, ...this.playersTeam2];
  }

  setupEventListeners() {
    // Gestione tastiera
    this.keysDown = {};

    window.addEventListener('keydown', (e) => {
      this.keysDown[e.code] = true;

      // Switch giocatore (Barra Spaziatrice o Q)
      if (e.code === 'Space' || e.code === 'KeyQ') {
        this.input.switchTrigger = true;
        e.preventDefault();
      }

      // Passaggio (Z o J)
      if (e.code === 'KeyZ' || e.code === 'KeyJ') {
        this.input.passTrigger = true;
      }

      // Scivolata o Tiro (X o K)
      if (e.code === 'KeyX' || e.code === 'KeyK') {
        const myTeam = this.options.isClient ? this.playersTeam2 : this.playersTeam1;
        const activeIdx = this.options.isClient ? this.activePlayerIdx2 : this.activePlayerIdx1;
        const activeP = myTeam[activeIdx];

        if (this.ball.holder === activeP) {
          // In possesso: inizia a caricare il tiro
          this.input.isChargingShot = true;
        } else {
          // Senza palla: scivolata difensiva immediata!
          this.input.slideTrigger = true;
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown[e.code] = false;

      // Rilascio tiro (X o K)
      if ((e.code === 'KeyX' || e.code === 'KeyK') && this.input.isChargingShot) {
        this.input.isChargingShot = false;
        this.input.shootTrigger = true;
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
    this.ball.holder = null;

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

    // Caricamento tiro
    if (this.input.isChargingShot) {
      this.input.shotPower = Math.min(1.0, this.input.shotPower + dt * 1.6);
    } else if (!this.input.shootTrigger) {
      this.input.shotPower = 0;
    }
  }

  // Aggiorna stato di un giocatore
  updatePlayer(p, inputData, dt) {
    const stats = p.charData;
    const baseSpeed = 13 + (stats.speed / 100) * 6; // 13 - 19 unità/sec
    const speedMult = inputData.sprint ? 1.35 : 1.0;
    const currentMaxSpeed = baseSpeed * speedMult;

    // Gestione scivolata
    if (p.isSliding) {
      p.slideTimer -= dt;
      p.vx *= 0.94;
      p.vz *= 0.94;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.rotation.x = Math.PI / 3; // inclinato a terra

      // Controlla se colpisce la palla durante la scivolata
      const distBall = Math.hypot(p.x - this.ball.x, p.z - this.ball.z);
      if (distBall < 2.0 && this.ball.holder !== p) {
        // Ruba palla con forza
        this.ball.holder = null;
        const kickDirX = Math.sin(p.rot);
        const kickDirZ = Math.cos(p.rot);
        const tacklePwr = 18 + (stats.tackle / 100) * 12;
        this.ball.vx = kickDirX * tacklePwr;
        this.ball.vz = kickDirZ * tacklePwr;
        this.ball.vy = 4;
        sounds.playSlide();
      }

      if (p.slideTimer <= 0) {
        p.isSliding = false;
        p.mesh.rotation.x = 0;
      }
      return;
    }

    // Trigger scivolata difensiva
    if (inputData.slideTrigger && !p.isSliding) {
      p.isSliding = true;
      p.slideTimer = 0.45;
      const slideSpeed = currentMaxSpeed * 1.5;
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

    // Gestione possesso palla
    if (this.ball.holder === p) {
      // La palla segue il giocatore davanti ai suoi piedi
      const ballOffsetDist = 1.1 * p.scale;
      this.ball.x = p.x + Math.sin(p.rot) * ballOffsetDist;
      this.ball.z = p.z + Math.cos(p.rot) * ballOffsetDist;
      this.ball.y = this.ball.radius;
      this.ball.vx = p.vx;
      this.ball.vz = p.vz;
      this.ball.vy = 0;

      // Esegui tiro se rilasciato
      if (inputData.shootTrigger) {
        const shotPowerNorm = Math.max(0.35, inputData.shotPower || 0.7);
        const powerMult = 22 + (stats.shot / 100) * 20; // 22 - 42 potenza
        const finalSpeed = shotPowerNorm * powerMult;

        // Direzione tiro verso porta avversaria con leggera influenza direzionale
        const targetGoalX = (p.team === 1) ? this.FIELD_W / 2 : -this.FIELD_W / 2;
        let shootAngle = Math.atan2(targetGoalX - p.x, -p.z);
        if (inputData.moveX !== 0 || inputData.moveZ !== 0) {
          shootAngle = p.rot;
        }

        this.ball.holder = null;
        this.ball.vx = Math.sin(shootAngle) * finalSpeed;
        this.ball.vz = Math.cos(shootAngle) * finalSpeed;
        this.ball.vy = 4 + shotPowerNorm * 7; // parabola verso l'alto

        if (shotPowerNorm > 0.75) {
          sounds.playPowerShot();
        } else {
          sounds.playKick(shotPowerNorm);
        }
      }
      // Esegui passaggio corto o filtrante
      else if (inputData.passTrigger) {
        const teammates = (p.team === 1) ? this.playersTeam1 : this.playersTeam2;
        const otherTeammates = teammates.filter(mate => mate !== p);

        // Trova compagno migliore (più avanzato o in direzione levetta)
        let bestTarget = otherTeammates[0];
        let bestScore = -9999;

        otherTeammates.forEach(mate => {
          const dx = mate.x - p.x;
          const dz = mate.z - p.z;
          const dist = Math.hypot(dx, dz);
          // Bonus se verso la porta avversaria e non coperto
          const forwardBonus = (p.team === 1) ? (mate.x - p.x) * 1.5 : (p.x - mate.x) * 1.5;
          const score = forwardBonus - dist * 0.4;
          if (score > bestScore) {
            bestScore = score;
            bestTarget = mate;
          }
        });

        const dx = bestTarget.x - p.x;
        const dz = bestTarget.z - p.z;
        const dist = Math.hypot(dx, dz);
        const passSpeed = Math.min(32, Math.max(16, dist * 1.3));

        this.ball.holder = null;
        this.ball.vx = (dx / dist) * passSpeed;
        this.ball.vz = (dz / dist) * passSpeed;
        this.ball.vy = 1.2;

        sounds.playKick(0.7);
      }
    } else {
      // Controlla intercetto / aggancio palla vagante
      const distToBall = Math.hypot(p.x - this.ball.x, p.z - this.ball.z);
      if (distToBall < 1.3 * p.scale && this.ball.y < 2.0 && !this.ball.holder) {
        this.ball.holder = p;
        sounds.playKick(0.4);
      }
    }
  }

  // Intelligenza Artificiale per i compagni di squadra e la CPU
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

    const team = (p.team === 1) ? this.playersTeam1 : this.playersTeam2;
    const opponentTeam = (p.team === 1) ? this.playersTeam2 : this.playersTeam1;
    const targetGoalX = (p.team === 1) ? this.FIELD_W / 2 : -this.FIELD_W / 2;
    const ownGoalX = (p.team === 1) ? -this.FIELD_W / 2 : this.FIELD_W / 2;

    const distToBall = Math.hypot(p.x - this.ball.x, p.z - this.ball.z);
    const hasBall = (this.ball.holder === p);

    // Se l'AI ha palla
    if (hasBall) {
      const distToTargetGoal = Math.abs(targetGoalX - p.x);

      // Se è vicino alla porta avversaria (sotto i 24m), carica il tiro e tira!
      if (distToTargetGoal < 24) {
        aiInput.shootTrigger = true;
        aiInput.shotPower = 0.8 + Math.random() * 0.2;
      } else {
        // Altrimenti avanza verso la porta o passa
        const goalDirX = (targetGoalX - p.x);
        const goalDirZ = (0 - p.z) * 0.3;
        const len = Math.hypot(goalDirX, goalDirZ);
        aiInput.moveX = goalDirX / len;
        aiInput.moveZ = goalDirZ / len;
        aiInput.sprint = true;

        // Possibilità di passaggio a compagno libero
        if (Math.random() < 0.02) {
          aiInput.passTrigger = true;
        }
      }
    } else {
      // In base al ruolo:
      if (p.role === 'gk') {
        // Difensore/Portiere saracinesca: rimane tra la palla e la propria porta
        const idealX = ownGoalX + (p.team === 1 ? 6 : -6);
        const idealZ = Math.max(-this.GOAL_W / 2 + 1, Math.min(this.GOAL_W / 2 - 1, this.ball.z * 0.6));

        // Se la palla è molto vicina alla porta, esce a prenderla
        if (Math.abs(this.ball.x - ownGoalX) < 14) {
          const dx = this.ball.x - p.x;
          const dz = this.ball.z - p.z;
          const len = Math.hypot(dx, dz);
          aiInput.moveX = dx / len;
          aiInput.moveZ = dz / len;
          if (distToBall < 3.0 && Math.random() < 0.05) {
            aiInput.slideTrigger = true;
          }
        } else {
          const dx = idealX - p.x;
          const dz = idealZ - p.z;
          const len = Math.hypot(dx, dz);
          if (len > 0.8) {
            aiInput.moveX = dx / len;
            aiInput.moveZ = dz / len;
          }
        }
      } else {
        // Attaccante / Mediano
        // Se la palla è libera o avversaria ed è il compagno più vicino, va ad aggredirla
        const teamHasBall = team.some(tm => tm === this.ball.holder);

        if (!teamHasBall && distToBall < 18) {
          const dx = this.ball.x - p.x;
          const dz = this.ball.z - p.z;
          const len = Math.hypot(dx, dz);
          aiInput.moveX = dx / len;
          aiInput.moveZ = dz / len;
          aiInput.sprint = distToBall > 6;

          // Se avversario in possesso a portata, scivolata
          if (this.ball.holder && this.ball.holder.team !== p.team && distToBall < 2.5 && Math.random() < 0.08) {
            aiInput.slideTrigger = true;
          }
        } else {
          // Posizionamento tattico: supporto all'attacco o copertura
          const targetX = p.baseX + (this.ball.x * 0.35);
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
    }

    this.updatePlayer(p, aiInput, dt);
  }

  // Fisica vettoriale della palla (rimbalzi, pali, gol)
  updateBall(dt) {
    if (this.ball.holder) return;

    // Gravità
    this.ball.vy -= 18.0 * dt;

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;
    this.ball.z += this.ball.vz * dt;

    // Attrito dell'erba e resistenza aria
    this.ball.vx *= (1 - 0.55 * dt);
    this.ball.vz *= (1 - 0.55 * dt);

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
      }
    }

    // Bordi laterali (Fallo laterale / rimbalzo su cartelloni)
    const halfH = this.FIELD_H / 2;
    if (Math.abs(this.ball.z) > halfH) {
      this.ball.z = Math.sign(this.ball.z) * halfH;
      this.ball.vz = -this.ball.vz * 0.65;
    }

    // Rotazione visiva palla
    const speed = Math.hypot(this.ball.vx, this.ball.vz);
    this.ball.rotX += speed * dt * 2;
    this.ballMesh.rotation.x = this.ball.rotX;
    this.ballMesh.rotation.z += this.ball.vx * dt * 2;

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

    if (this.options.onGoal) {
      this.options.onGoal(scoringTeam, this.score);
    }
  }

  // Loop Principale
  animate(time) {
    requestAnimationFrame(this.animate);

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

    // 3. Indicatori visivi di selezione
    const activeIdx1 = this.activePlayerIdx1;
    this.playersTeam1.forEach((p, idx) => {
      const isActive = (idx === activeIdx1);
      p.ringMat.opacity = isActive ? 0.85 : 0;
      p.arrowMat.opacity = (isActive && this.ball.holder === p) ? 0.9 : 0;
    });

    const activeIdx2 = this.activePlayerIdx2;
    this.playersTeam2.forEach((p, idx) => {
      const isActive = (idx === activeIdx2);
      p.ringMat.opacity = isActive ? 0.85 : 0;
      p.arrowMat.opacity = (isActive && this.ball.holder === p) ? 0.9 : 0;
    });

    // 4. Telecamera dinamica 2.5D (insegue dolcemente la palla e l'azione)
    const targetCamX = this.ball.x * 0.45;
    const targetCamZ = this.ball.z * 0.35 + 46;
    this.camera.position.x += (targetCamX - this.camera.position.x) * 4.0 * dt;
    this.camera.position.z += (targetCamZ - this.camera.position.z) * 4.0 * dt;
    this.camera.lookAt(this.ball.x * 0.45, 0, this.ball.z * 0.35);

    // 5. Render scena
    this.renderer.render(this.scene, this.camera);

    // Callback per aggiornamento HUD (Scoreboard, Timer, Minimappa)
    if (this.options.onUpdateHUD) {
      this.options.onUpdateHUD({
        score: this.score,
        matchTime: Math.ceil(this.matchTime),
        ball: { x: this.ball.x, z: this.ball.z },
        p1: this.playersTeam1.map(p => ({ x: p.x, z: p.z, id: p.id, name: p.name })),
        p2: this.playersTeam2.map(p => ({ x: p.x, z: p.z, id: p.id, name: p.name })),
        shotPower: this.input.shotPower
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
