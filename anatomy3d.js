// FlexiTrack — Anatomy 3D Viewer (visuel cinématique)
// GLTF Z-Anatomy : érecteurs mis en lumière, reste du corps en fantôme discret
// Fallback procédural si le GLB est absent
(function () {
    let renderer, scene, camera, controls;
    let animFrameId = null;
    let isInitialized = false;
    let matRef    = null;   // pour l'animation de pulsation
    let glowLights = [];    // lumières animées

    const MODEL_PATH = 'model/human.glb';
    const DRACO_PATH = 'draco/';

    // ── Helpers ───────────────────────────────────────────────────────────────
    const unitSphere = new THREE.SphereGeometry(1, 18, 24);

    function capsule(mat, r, h, x, y, z, rx, rz) {
        const m = new THREE.Mesh(unitSphere, mat);
        m.scale.set(r, r + h / 2, r);
        m.position.set(x, y, z);
        m.rotation.set(rx || 0, 0, rz || 0);
        m.castShadow = true; m.receiveShadow = true;
        scene.add(m); return m;
    }

    function mesh(geo, mat, x, y, z, rx, ry, rz) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        if (rx !== undefined) m.rotation.set(rx, ry || 0, rz || 0);
        m.castShadow = true; m.receiveShadow = true;
        scene.add(m); return m;
    }

    // ── Fond dégradé radial ───────────────────────────────────────────────────
    function makeBackground() {
        const c = document.createElement('canvas');
        c.width = c.height = 512;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 360);
        g.addColorStop(0.00, '#101e36');
        g.addColorStop(0.55, '#080f1e');
        g.addColorStop(1.00, '#030710');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 512, 512);
        return new THREE.CanvasTexture(c);
    }

    // ── Matériaux PBR ─────────────────────────────────────────────────────────
    function makeMaterials() {
        return {
            // Corps procédural (fallback)
            body: new THREE.MeshStandardMaterial({
                color: 0x1c3050, roughness: 0.82, metalness: 0.10,
                transparent: true, opacity: 0.90,
            }),
            muscle: new THREE.MeshStandardMaterial({
                color: 0x122236, roughness: 0.90, metalness: 0.0,
                transparent: true, opacity: 0.82,
            }),
            // GLTF : muscles non-érecteurs → silhouette fantôme acier
            muscleDefault: new THREE.MeshStandardMaterial({
                color: 0x162d46, roughness: 0.92, metalness: 0.0,
                transparent: true, opacity: 0.11, depthWrite: false,
            }),
            // Érecteur gauche — cyan électrique
            erL: new THREE.MeshStandardMaterial({
                color: 0x00e5ff, roughness: 0.10, metalness: 0.0,
                emissive: new THREE.Color(0x00e5ff), emissiveIntensity: 4.5,
            }),
            // Érecteur droit — violet lumineux
            erR: new THREE.MeshStandardMaterial({
                color: 0xb87dff, roughness: 0.10, metalness: 0.0,
                emissive: new THREE.Color(0xb87dff), emissiveIntensity: 4.5,
            }),
        };
    }

    // ── Corps procédural (fallback) ───────────────────────────────────────────
    function buildProceduralBody(mat) {
        const { body, muscle, erL, erR } = mat;

        mesh(new THREE.SphereGeometry(0.37, 28, 22), body, 0, 6.22, 0);
        mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.45, 16), body, 0, 5.76, 0);

        const torsoProfile = [
            new THREE.Vector2(0.52, 0.00), new THREE.Vector2(0.58, 0.40),
            new THREE.Vector2(0.50, 0.80), new THREE.Vector2(0.36, 1.40),
            new THREE.Vector2(0.45, 1.90), new THREE.Vector2(0.59, 2.35),
            new THREE.Vector2(0.65, 2.76), new THREE.Vector2(0.58, 3.12),
            new THREE.Vector2(0.46, 3.44),
        ];
        const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 32), body);
        torso.position.set(0, 2.30, 0);
        torso.castShadow = true; torso.receiveShadow = true;
        scene.add(torso);

        mesh(new THREE.SphereGeometry(0.29, 18, 14), body, -0.86, 5.58, 0);
        mesh(new THREE.SphereGeometry(0.29, 18, 14), body,  0.86, 5.58, 0);
        capsule(body, 0.16, 0.90, -1.06, 4.78, 0, 0.10,  0.18);
        capsule(body, 0.16, 0.90,  1.06, 4.78, 0, 0.10, -0.18);
        mesh(new THREE.SphereGeometry(0.19, 16, 12), body, -1.22, 4.02, 0);
        mesh(new THREE.SphereGeometry(0.19, 16, 12), body,  1.22, 4.02, 0);
        capsule(body, 0.13, 0.76, -1.32, 3.36, 0, 0.06,  0.20);
        capsule(body, 0.13, 0.76,  1.32, 3.36, 0, 0.06, -0.20);
        mesh(new THREE.SphereGeometry(0.14, 14, 10), body, -1.40, 2.78, 0);
        mesh(new THREE.SphereGeometry(0.14, 14, 10), body,  1.40, 2.78, 0);
        mesh(new THREE.SphereGeometry(0.25, 16, 12), body, -0.30, 2.44, 0);
        mesh(new THREE.SphereGeometry(0.25, 16, 12), body,  0.30, 2.44, 0);
        capsule(body, 0.23, 1.22, -0.33, 1.55, 0, 0.04,  0.02);
        capsule(body, 0.23, 1.22,  0.33, 1.55, 0, 0.04, -0.02);
        mesh(new THREE.SphereGeometry(0.21, 16, 12), body, -0.35, 0.80, 0);
        mesh(new THREE.SphereGeometry(0.21, 16, 12), body,  0.35, 0.80, 0);
        capsule(body, 0.16, 1.04, -0.35, -0.04, 0, 0.02,  0.01);
        capsule(body, 0.16, 1.04,  0.35, -0.04, 0, 0.02, -0.01);
        mesh(new THREE.SphereGeometry(0.14, 12,  8), body, -0.35, -0.62, 0);
        mesh(new THREE.SphereGeometry(0.14, 12,  8), body,  0.35, -0.62, 0);
        mesh(new THREE.BoxGeometry(0.25, 0.17, 0.62), body, -0.34, -0.76, 0.15);
        mesh(new THREE.BoxGeometry(0.25, 0.17, 0.62), body,  0.34, -0.76, 0.15);

        // Muscles dorsaux overlay
        const trapGeo = new THREE.SphereGeometry(1, 18, 14);
        const latGeo  = new THREE.SphereGeometry(1, 16, 12);
        const glutGeo = new THREE.SphereGeometry(1, 16, 12);
        [
            [-0.34, 5.20, -0.52, 0.34, 0.30, 0.14, trapGeo],
            [ 0.34, 5.20, -0.52, 0.34, 0.30, 0.14, trapGeo],
            [ 0.00, 5.05, -0.55, 0.28, 0.50, 0.12, trapGeo],
            [-0.48, 3.80, -0.54, 0.26, 0.65, 0.13, latGeo ],
            [ 0.48, 3.80, -0.54, 0.26, 0.65, 0.13, latGeo ],
            [-0.28, 2.20, -0.56, 0.28, 0.24, 0.18, glutGeo],
            [ 0.28, 2.20, -0.56, 0.28, 0.24, 0.18, glutGeo],
        ].forEach(([x, y, z, sx, sy, sz, geo]) => {
            const m2 = new THREE.Mesh(geo, muscle);
            m2.scale.set(sx, sy, sz); m2.position.set(x, y, z);
            m2.castShadow = true; scene.add(m2);
        });

        // Érecteurs cyan (gauche) et violet (droit)
        capsule(erL, 0.098, 2.45, -0.155, 3.70, -0.65);
        capsule(erR, 0.098, 2.45,  0.155, 3.70, -0.65);

        // Marqueurs électrodes
        const ringGeo = new THREE.TorusGeometry(0.052, 0.012, 8, 22);
        const ringMat = new THREE.MeshStandardMaterial({
            color: 0xffffff, roughness: 0.15, metalness: 0.85,
            emissive: new THREE.Color(0x999999), emissiveIntensity: 0.5
        });
        const dotGeo = new THREE.SphereGeometry(0.018, 8, 6);
        [
            [-0.155, 4.75, -0.72, 0x00e5ff, 0x005566],
            [-0.155, 3.70, -0.72, 0x00e5ff, 0x005566],
            [-0.155, 2.65, -0.72, 0x00e5ff, 0x005566],
            [ 0.155, 4.75, -0.72, 0xb87dff, 0x2a0855],
            [ 0.155, 3.70, -0.72, 0xb87dff, 0x2a0855],
            [ 0.155, 2.65, -0.72, 0xb87dff, 0x2a0855],
        ].forEach(([x, y, z, col, em]) => {
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.set(x, y, z); ring.rotation.y = Math.PI / 2;
            scene.add(ring);
            const dot = new THREE.Mesh(dotGeo, new THREE.MeshStandardMaterial({
                color: col, emissive: new THREE.Color(em), emissiveIntensity: 2.0,
                roughness: 0.1, metalness: 0
            }));
            dot.position.set(x, y, z + 0.015);
            scene.add(dot);
        });
    }

    // ── Chargement GLTF / Draco ───────────────────────────────────────────────
    function tryLoadGLTF(mat, onFail) {
        if (typeof THREE.DRACOLoader === 'undefined' || typeof THREE.GLTFLoader === 'undefined') {
            onFail(new Error('Loaders non disponibles'));
            return;
        }
        const dracoLoader = new THREE.DRACOLoader();
        dracoLoader.setDecoderPath(DRACO_PATH);

        const loader = new THREE.GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        loader.load(MODEL_PATH, (gltf) => {
            const model = gltf.scene;
            const box    = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size   = box.getSize(new THREE.Vector3());
            const scale  = 6.0 / Math.max(size.x, size.y, size.z);
            model.scale.setScalar(scale);
            model.position.sub(center.multiplyScalar(scale));
            model.position.y += 2.8;

            const erectorKw = ['iliocost', 'longissim', 'spinalis', 'multifid', 'semispinal', 'erector', 'erecteur'];

            model.traverse(child => {
                if (!child.isMesh) return;
                child.castShadow = true; child.receiveShadow = true;
                const name = (child.name || '').toLowerCase();
                const isEr = erectorKw.some(k => name.includes(k));
                if (isEr) {
                    const isL = name.endsWith('.l') || name.includes('.l ') || name.includes('_l_') || name.includes(' left');
                    child.material = isL ? mat.erL : mat.erR;
                } else {
                    child.material = mat.muscleDefault;
                }
            });

            scene.add(model);
        }, undefined, onFail);
    }

    // ── Éclairage cinématique ─────────────────────────────────────────────────
    function setupLighting() {
        // Ambiante profonde — laisse les zones non-éclairées très sombres
        scene.add(new THREE.AmbientLight(0x08121e, 0.50));

        // Lumière principale chaude (avant-haut gauche)
        const key = new THREE.DirectionalLight(0xfff3e0, 1.0);
        key.position.set(5, 12, 2);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = 1; key.shadow.camera.far = 30;
        key.shadow.camera.left = key.shadow.camera.bottom = -6;
        key.shadow.camera.right = key.shadow.camera.top  =  6;
        scene.add(key);

        // Remplissage frontal doux (bleu froid)
        const fill = new THREE.DirectionalLight(0x3366bb, 0.22);
        fill.position.set(-4, 2, 6);
        scene.add(fill);

        // Rim lights latéraux → dessinent le contour du corps depuis l'arrière
        const rimL = new THREE.DirectionalLight(0x1155ee, 1.3);
        rimL.position.set(-6, 5, -6);
        scene.add(rimL);

        const rimR = new THREE.DirectionalLight(0x0044cc, 0.75);
        rimR.position.set( 6, 5, -6);
        scene.add(rimR);

        // Contre-jour doux du dessus
        const top = new THREE.DirectionalLight(0x5577aa, 0.30);
        top.position.set(0, 14, -1);
        scene.add(top);

        // 4 points de glow érecteurs (haut+bas × gauche+droit)
        [
            // [couleur, x,    y,   z,   intensité, portée, phase]
            [0x00e5ff, -0.6,  4.5, -0.8,  10, 3.6, 0.00],
            [0x00e5ff, -0.6,  2.2, -0.8,  10, 3.6, 0.30],
            [0xb87dff,  0.6,  4.5, -0.8,  10, 3.6, 1.05],
            [0xb87dff,  0.6,  2.2, -0.8,  10, 3.6, 1.35],
        ].forEach(([col, x, y, z, intensity, dist, phase]) => {
            const pl = new THREE.PointLight(col, intensity, dist);
            pl.position.set(x, y, z);
            pl.userData.baseIntensity = intensity;
            pl.userData.phase         = phase;
            scene.add(pl);
            glowLights.push(pl);
        });
    }

    // ── Sol ───────────────────────────────────────────────────────────────────
    function addFloor() {
        // Disque légèrement réfléchissant
        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(7, 64),
            new THREE.MeshStandardMaterial({
                color: 0x050d1a, roughness: 0.75, metalness: 0.25,
                transparent: true, opacity: 0.90
            })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y  = -0.86;
        floor.receiveShadow = true;
        scene.add(floor);

        // Anneaux concentriques cyan / violet
        [
            { i: 0.18, o: 0.32, col: 0x00e5ff, op: 0.40 },
            { i: 0.50, o: 0.62, col: 0x00c4e8, op: 0.20 },
            { i: 0.88, o: 0.96, col: 0xb87dff, op: 0.16 },
            { i: 1.35, o: 1.40, col: 0x0077cc, op: 0.10 },
            { i: 2.00, o: 2.03, col: 0x004466, op: 0.07 },
        ].forEach(({ i, o, col, op }) => {
            const r = new THREE.Mesh(
                new THREE.RingGeometry(i, o, 64),
                new THREE.MeshBasicMaterial({
                    color: col, transparent: true, opacity: op, side: THREE.DoubleSide
                })
            );
            r.rotation.x = -Math.PI / 2;
            r.position.y  = -0.85;
            scene.add(r);
        });
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    window.initAnatomy3D = function () {
        if (isInitialized) return;
        isInitialized = true;
        glowLights = [];

        const container = document.getElementById('anatomy3dContainer');
        if (!container) return;

        const W = container.clientWidth  || 640;
        const H = container.clientHeight || 720;

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(W, H);
        renderer.shadowMap.enabled    = true;
        renderer.shadowMap.type       = THREE.PCFSoftShadowMap;
        renderer.outputEncoding       = THREE.sRGBEncoding;
        renderer.toneMapping          = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure  = 1.28;
        renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
        container.appendChild(renderer.domElement);

        scene = new THREE.Scene();
        scene.background = makeBackground();
        scene.fog = new THREE.FogExp2(0x060e1c, 0.020);

        camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
        camera.position.set(0, 3.2, -9);
        camera.lookAt(0, 3.2, 0);

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping   = true;
        controls.dampingFactor   = 0.055;
        controls.target.set(0, 3.2, 0);
        controls.minDistance     = 2.5;
        controls.maxDistance     = 18;
        controls.autoRotate      = true;
        controls.autoRotateSpeed = 0.32;
        controls.update();

        setupLighting();
        addFloor();

        matRef = makeMaterials();
        tryLoadGLTF(matRef, () => buildProceduralBody(matRef));

        const viewLabel = document.getElementById('viewLabel');

        const ro = new ResizeObserver(() => {
            if (!renderer || !container.clientWidth) return;
            const w = container.clientWidth, h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        });
        ro.observe(container);

        (function animate() {
            animFrameId = requestAnimationFrame(animate);
            controls.update();

            // Pulsation douce — érecteurs « respirent »
            if (matRef) {
                const t = performance.now() * 0.001;
                matRef.erL.emissiveIntensity = 4.0 + 1.2 * Math.sin(t * 1.25);
                matRef.erR.emissiveIntensity = 4.0 + 1.2 * Math.sin(t * 1.25 + 1.05);
            }

            // Pulsation synchronisée des lumières de glow
            if (glowLights.length) {
                const t = performance.now() * 0.001;
                glowLights.forEach(l => {
                    l.intensity = l.userData.baseIntensity *
                        (1.0 + 0.28 * Math.sin(t * 1.25 + l.userData.phase));
                });
            }

            if (viewLabel) {
                const az = Math.atan2(
                    camera.position.x - controls.target.x,
                    camera.position.z - controls.target.z
                ) * (180 / Math.PI);
                viewLabel.textContent = Math.abs(az) > 90
                    ? 'Vue Postérieure — Érecteurs visibles'
                    : 'Vue Antérieure';
            }

            renderer.render(scene, camera);
        })();
    };

    window.stopAnatomy3D = function () {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        if (renderer) {
            renderer.dispose();
            if (renderer.domElement.parentNode)
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            renderer = null;
        }
        scene = null; camera = null; controls = null;
        matRef = null; glowLights = [];
        isInitialized = false;
    };

    window.resumeAnatomy3D = function () {};
})();
