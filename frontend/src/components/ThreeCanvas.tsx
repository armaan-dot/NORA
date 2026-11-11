import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { rosService } from '../services/rosService';
import { WristCamera, cameraFeed } from '../sim/wristCamera';
import { annotate } from '../sim/vision';
import { createObjectMesh, createContactShadow, footprintRadius, objectKind } from '../sim/objectMeshes';
import { topicBus } from '../sim/topicBus';
import { simWorld } from '../sim/world';
import { TOTE_GEOM } from '../sim/physics';
import { checkReach, MAX_TABLE_REACH, GRASP_MIN_TCP_HEIGHT } from '../sim/kinematics';
import type { ArmSpeechEvent, GuardrailEvent, JointState, ObjectPosition, PerceptionScanEvent, TabletopObject } from '../types';
import { AddObjectModal } from './AddObjectModal';
import {
  RotateCcw,
  Grid,
  RefreshCw,
  Shuffle,
  Move,

  Plus,
  Trash2,
  AlertOctagon,
  Box,
  ChevronDown,
  ChevronUp,
  Square,
  Play,
  XCircle,
  ShieldAlert,
  Camera,
  Boxes
} from 'lucide-react';

const readGripSensor = () => simWorld.tactile;

export const ThreeCanvas: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const robotRef = useRef<URDFRobot | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const objectGroupRef = useRef<THREE.Group | null>(null);
  const armCameraGroupRef = useRef<THREE.Group | null>(null);
  const cameraFrustumRef = useRef<THREE.Group | null>(null);
  const cameraLedRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const wristCamRef = useRef<WristCamera | null>(null);

  // Dynamic mesh references
  const objectMeshesRef = useRef<Record<string, THREE.Object3D>>({});
  const objectPositionsRef = useRef<Record<string, ObjectPosition>>(
    rosService.getAllObjectPositions()
  );

  const [tableObjects, setTableObjects] = useState<TabletopObject[]>(
    rosService.getObjects()
  );
  const [livePositions, setLivePositions] = useState<Record<string, ObjectPosition>>(
    rosService.getAllObjectPositions()
  );
  const [scanEvent, setScanEvent] = useState<PerceptionScanEvent | null>(null);
  const [cameraPerceivedCount, setCameraPerceivedCount] = useState<number | null>(null);
  const [draggingItem, setDraggingItem] = useState<string | null>(null);
  const [dragCoords, setDragCoords] = useState<{ x: number; z: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showColliders, setShowColliders] = useState(false);
  const showCollidersRef = useRef(false);
  const [physStats, setPhysStats] = useState<{ rtf: number; stepMs: number; bodies: number } | null>(null);
  const [gripSensor, setGripSensor] = useState<ReturnType<typeof readGripSensor> | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEStopped, setIsEStopped] = useState(rosService.getIsEStopped());
  const [showObjectsPopover, setShowObjectsPopover] = useState(false);
  const [armSpeech, setArmSpeech] = useState<ArmSpeechEvent | null>(null);
  const [guardrailEvent, setGuardrailEvent] = useState<GuardrailEvent | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);

  const handleQuickSpawn = (
    name: string,
    shape: 'mug' | 'apple' | 'glass' | 'box' | 'cylinder' | 'sphere',
    color: string
  ) => {
    rosService.addObject({
      name,
      shape,
      color,
      zone: 'auto'
    });
    setTableObjects(rosService.getObjects());
    setLivePositions(rosService.getAllObjectPositions());
  };

  // Scanner visuals references
  const scanGroupRef = useRef<THREE.Group | null>(null);
  const targetReticleRef = useRef<THREE.Group | null>(null);

  const isDraggingRef = useRef(false);
  const activeDragObjectRef = useRef<string | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene setup — neutral lab/workcell look
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const backdrop = 0x1b1e22;
    scene.background = new THREE.Color(backdrop);
    scene.fog = new THREE.Fog(backdrop, 5, 13);

    // 2. Camera setup - Zoomed out default view for clear perspective
    const width = container.clientWidth;
    const height = container.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    camera.position.set(1.65, 1.55, 1.85); // Zoomed out perspective framing table and arm
    cameraRef.current = camera;

    // 3. Renderer setup — filmic tone mapping + image-based lighting for believable metals
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTexture = pmrem.fromScene(roomEnv, 0.04).texture;
    scene.environment = envTexture;
    scene.environmentIntensity = 0.75;
    roomEnv.dispose();

    // 4. Controls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(-0.05, 0.46, 0.04); // Focus at center of tabletop workspace
    controls.maxPolarAngle = Math.PI / 2 + 0.05;
    controls.minDistance = 0.5;
    controls.maxDistance = 6.0;
    controlsRef.current = controls;
    if (new URLSearchParams(location.search).has('debug')) {
      // Inspection hook (?debug): lets scripts frame the scene and read back the render state.
      (window as unknown as Record<string, unknown>).__noraView = {
        camera, controls, scene, renderer, objectMeshes: objectMeshesRef,
        get wristCam() {
          return wristCamRef.current;
        }
      };
    }

    // 5. Lighting — soft overhead key, cool fill, sky/ground bounce
    const hemiLight = new THREE.HemisphereLight(0xeef3fa, 0x4a443c, 0.5);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff3e3, 2.8);
    keyLight.position.set(1.8, 4.2, 1.4);
    keyLight.target.position.set(-0.1, 0.4, 0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -1.6;
    keyLight.shadow.camera.right = 1.6;
    keyLight.shadow.camera.top = 1.6;
    keyLight.shadow.camera.bottom = -1.6;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 9;
    keyLight.shadow.bias = -0.0002;
    keyLight.shadow.normalBias = 0.015;
    keyLight.shadow.radius = 3;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const fillLight = new THREE.DirectionalLight(0xdde6f2, 0.45);
    fillLight.position.set(-2.5, 2.0, -1.5);
    scene.add(fillLight);

    // 6. Floor (sealed concrete) & subtle reference grid
    const makeNoiseTexture = (size: number, base: number, spread: number): THREE.CanvasTexture => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(size, size);
      for (let i = 0; i < size * size; i++) {
        const v = base + (Math.random() - 0.5) * spread;
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const floorTex = makeNoiseTexture(256, 200, 26);
    floorTex.repeat.set(10, 10);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x4a4d52,
      map: floorTex,
      roughness: 0.9,
      metalness: 0.0
    });
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const grid = new THREE.GridHelper(6, 30, 0x55595e, 0x484b50);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = 0.001;
    scene.add(grid);
    gridHelperRef.current = grid;
    grid.layers.set(1); // overlay layer: visible to the viewport camera only, not the wrist camera
    camera.layers.enable(1);

    // 7. Workbench: laminate top on a 40 mm aluminium-extrusion frame
    const tableHeight = 0.45;
    const tableTopThickness = 0.03;
    const tableWidth = 1.3;
    const tableDepth = 0.9;
    const profile = 0.04;

    const tableGroup = new THREE.Group();

    const topTex = makeNoiseTexture(128, 228, 10);
    topTex.repeat.set(4, 3);
    const tabletopMat = new THREE.MeshStandardMaterial({
      color: 0x878a87,
      map: topTex,
      roughness: 0.62,
      metalness: 0.0
    });
    const tabletop = new THREE.Mesh(
      new THREE.BoxGeometry(tableWidth, tableTopThickness, tableDepth),
      tabletopMat
    );
    tabletop.position.y = tableHeight - tableTopThickness / 2;
    tabletop.receiveShadow = true;
    tabletop.castShadow = true;
    tableGroup.add(tabletop);

    const extrusionMat = new THREE.MeshStandardMaterial({
      color: 0xb9bdc2,
      metalness: 0.75,
      roughness: 0.38
    });
    const addBar = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), extrusionMat);
      bar.position.set(x, y, z);
      bar.castShadow = true;
      bar.receiveShadow = true;
      tableGroup.add(bar);
    };

    const footHeight = 0.02;
    const frameTop = tableHeight - tableTopThickness;
    const legH = frameTop - footHeight;
    const lx = tableWidth / 2 - 0.05;
    const lz = tableDepth / 2 - 0.05;
    const footMat = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.7, metalness: 0.2 });
    const footGeo = new THREE.CylinderGeometry(0.022, 0.026, footHeight, 20);
    [
      [-lx, -lz],
      [lx, -lz],
      [-lx, lz],
      [lx, lz]
    ].forEach(([x, z]) => {
      addBar(profile, legH, profile, x, footHeight + legH / 2, z);
      const foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(x, footHeight / 2, z);
      foot.castShadow = true;
      tableGroup.add(foot);
    });
    // Apron rails directly under the top, and lower stretchers
    [frameTop - profile / 2, 0.12].forEach((y) => {
      addBar(2 * lx - profile, profile, profile, 0, y, -lz);
      addBar(2 * lx - profile, profile, profile, 0, y, lz);
      addBar(profile, profile, 2 * lz - profile, -lx, y, 0);
      addBar(profile, profile, 2 * lz - profile, lx, y, 0);
    });
    scene.add(tableGroup);

    const surfaceY = tableHeight;

    // 8. Robot mounting plate bolted to the bench (steel, M8 socket-head screws)
    const mountGroup = new THREE.Group();
    mountGroup.position.set(rosService.robotBasePos.x, surfaceY, rosService.robotBasePos.z);

    const plateMat = new THREE.MeshStandardMaterial({ color: 0x8e9196, metalness: 0.85, roughness: 0.42 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.006, 0.24), plateMat);
    plate.position.y = -0.002;
    plate.castShadow = true;
    plate.receiveShadow = true;
    mountGroup.add(plate);

    const screwMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.7, roughness: 0.4 });
    const screwGeo = new THREE.CylinderGeometry(0.0065, 0.0065, 0.006, 16);
    [
      [-0.1, -0.1],
      [0.1, -0.1],
      [-0.1, 0.1],
      [0.1, 0.1]
    ].forEach(([x, z]) => {
      const screw = new THREE.Mesh(screwGeo, screwMat);
      screw.position.set(x, 0.003, z);
      mountGroup.add(screw);
    });
    scene.add(mountGroup);

    // 9. Operator handover station: rubber mat inside yellow floor-marking tape
    const handoverGroup = new THREE.Group();
    handoverGroup.position.set(rosService.handoverPos.x, surfaceY, rosService.handoverPos.z);

    const handoverMat = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.004, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x35373a, roughness: 0.95, metalness: 0.0 })
    );
    handoverMat.position.y = 0.002;
    handoverMat.receiveShadow = true;
    handoverGroup.add(handoverMat);

    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xd8b023, roughness: 0.55, metalness: 0.0 });
    const tapeW = 0.014;
    const tw = 0.25;
    const td = 0.19;
    [
      [tw + tapeW, td / 2, 0],
      [tw + tapeW, -td / 2, 0]
    ].forEach(([len, z]) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.0008, tapeW), tapeMat);
      strip.position.set(0, 0.0004, z);
      strip.receiveShadow = true;
      handoverGroup.add(strip);
    });
    [tw / 2, -tw / 2].forEach((x) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(tapeW, 0.0008, td - tapeW), tapeMat);
      strip.position.set(x, 0.0004, 0);
      strip.receiveShadow = true;
      handoverGroup.add(strip);
    });
    scene.add(handoverGroup);

    // 10. Storage tote (injection-moulded plastic bin)
    const toteMat = new THREE.MeshStandardMaterial({ color: 0x3f5f80, roughness: 0.55, metalness: 0.0 });
    const toteGroup = new THREE.Group();
    toteGroup.position.set(TOTE_GEOM.cx, surfaceY, TOTE_GEOM.cz);
    const toteSize = TOTE_GEOM.size;
    const wallT = TOTE_GEOM.wall;
    const wallH = TOTE_GEOM.wallH;
    const toteFloor = new THREE.Mesh(new THREE.BoxGeometry(toteSize, wallT, toteSize), toteMat);
    toteFloor.position.y = wallT / 2;
    toteFloor.receiveShadow = true;
    toteGroup.add(toteFloor);
    [
      [toteSize, wallT, 0, toteSize / 2 - wallT / 2],
      [toteSize, wallT, 0, -toteSize / 2 + wallT / 2],
      [wallT, toteSize, toteSize / 2 - wallT / 2, 0],
      [wallT, toteSize, -toteSize / 2 + wallT / 2, 0]
    ].forEach(([sx, sz, x, z]) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, wallH, sz), toteMat);
      wall.position.set(x, wallH / 2, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      toteGroup.add(wall);
    });
    scene.add(toteGroup);

    // 9. Object Group for Dynamic Workspace Items
    const objectGroup = new THREE.Group();
    scene.add(objectGroup);
    objectGroupRef.current = objectGroup;

    // Soft contact shadows under every object (ambient occlusion where it touches the table)
    const shadowGroup = new THREE.Group();
    shadowGroup.layers.set(0);
    scene.add(shadowGroup);
    const shadows: Record<string, THREE.Mesh> = {};

    // Helper to synchronize 3D meshes with dynamic tabletop objects list
    const syncMeshes = (objects: TabletopObject[]) => {
      if (!objectGroupRef.current) return;
      const currentIds = new Set(objects.map((o) => o.id));

      // 1. Remove meshes that no longer exist
      Object.keys(objectMeshesRef.current).forEach((id) => {
        if (!currentIds.has(id)) {
          const m = objectMeshesRef.current[id];
          if (m) {
            objectGroupRef.current?.remove(m);
            m.traverse((child: any) => {
              if (child.geometry) child.geometry.dispose();
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach((mat: any) => mat.dispose());
                } else {
                  child.material.dispose();
                }
              }
            });
            delete objectMeshesRef.current[id];
            const sh = shadows[id];
            if (sh) {
              shadowGroup.remove(sh);
              sh.geometry.dispose();
              (sh.material as THREE.Material).dispose();
              delete shadows[id];
            }
          }
        }
      });

      // 2. Add or update meshes for all objects
      objects.forEach((obj) => {
        const existing = objectMeshesRef.current[obj.id];
        if (!existing || existing.parent !== objectGroupRef.current) {
          if (existing) {
            objectGroupRef.current?.remove(existing);
          }
          const newMesh = createObjectMesh(obj);
          objectGroupRef.current?.add(newMesh);
          objectMeshesRef.current[obj.id] = newMesh;
          if (!shadows[obj.id]) {
            const sh = createContactShadow(footprintRadius(objectKind(obj)));
            shadowGroup.add(sh);
            shadows[obj.id] = sh;
          }
        }
        if (obj.position) {
          objectPositionsRef.current[obj.id] = { ...obj.position };
        }
      });
    };

    // Clear any previous scene mesh cache and initialize fresh
    objectMeshesRef.current = {};
    syncMeshes(rosService.getObjects());

    // 10. Perception overlay: faint view cone while scanning, target marker on detection
    const scanGroup = new THREE.Group();
    scanGroup.visible = false;

    const scanConeGeo = new THREE.ConeGeometry(0.25, 0.45, 48, 1, true);
    scanConeGeo.translate(0, -0.225, 0);
    const scanConeMesh = new THREE.Mesh(
      scanConeGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    scanGroup.add(scanConeMesh);
    scene.add(scanGroup);
    scanGroupRef.current = scanGroup;
    scanGroup.traverse((o) => o.layers.set(1));

    // Target marker: thin ring + bounding box outline
    const reticleGroup = new THREE.Group();
    reticleGroup.visible = false;
    const reticleGeo = new THREE.RingGeometry(0.05, 0.054, 48);
    reticleGeo.rotateX(-Math.PI / 2);
    const reticleMesh = new THREE.Mesh(
      reticleGeo,
      new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    reticleGroup.add(reticleMesh);

    const boxLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.09, 0.09, 0.09)),
      new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.45 })
    );
    reticleGroup.add(boxLines);

    scene.add(reticleGroup);
    targetReticleRef.current = reticleGroup;
    reticleGroup.traverse((o) => o.layers.set(1));

    // 11. Load NORA URDF
    const loader = new URDFLoader();
    loader.load(
      '/nora_arm.urdf',
      (robot) => {
        robot.position.set(rosService.robotBasePos.x, surfaceY, rosService.robotBasePos.z);
        robot.rotation.x = -Math.PI / 2;

        // Swap urdf-loader's flat Phong materials for PBR finishes matching a UR5e:
        // bead-blasted aluminium links, light-blue joint caps, black seals.
        const finishes: Record<string, { metalness: number; roughness: number }> = {
          ur_aluminium: { metalness: 0.55, roughness: 0.38 },
          ur_cap: { metalness: 0.1, roughness: 0.45 },
          ur_seal: { metalness: 0.0, roughness: 0.85 },
          steel: { metalness: 0.9, roughness: 0.25 },
          gripper_body: { metalness: 0.35, roughness: 0.5 },
          gripper_pad: { metalness: 0.0, roughness: 0.95 }
        };
        const pbrCache = new Map<string, THREE.MeshStandardMaterial>();
        robot.traverse((child: any) => {
          if (!child.isMesh) return;
          child.castShadow = true;
          child.receiveShadow = true;
          const src = child.material as THREE.MeshPhongMaterial;
          const key = src.name || src.color.getHexString();
          let pbr = pbrCache.get(key);
          if (!pbr) {
            const finish = finishes[src.name] ?? { metalness: 0.4, roughness: 0.45 };
            pbr = new THREE.MeshStandardMaterial({ color: src.color.clone(), ...finish });
            pbrCache.set(key, pbr);
          }
          src.dispose();
          child.material = pbr;
        });

        // Mount procedural Eye-in-Hand RGB-D Depth Camera to the arm wrist
        const gripperLink =
          robot.getObjectByName('gripper_link') ||
          robot.getObjectByName('link6');

        if (gripperLink) {
          const armCameraGroup = new THREE.Group();
          armCameraGroup.name = 'on_arm_depth_camera';

          // 1. Machined Anodized Mounting Bracket
          const bracketGeo = new THREE.BoxGeometry(0.045, 0.016, 0.012);
          const bracketMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            metalness: 0.85,
            roughness: 0.35
          });
          const bracketMesh = new THREE.Mesh(bracketGeo, bracketMat);
          bracketMesh.position.set(0, -0.024, 0.038);
          armCameraGroup.add(bracketMesh);

          // 2. Camera Enclosure Housing (Intel RealSense D435 form-factor)
          const camBodyGeo = new THREE.BoxGeometry(0.090, 0.024, 0.024);
          const camBodyMat = new THREE.MeshStandardMaterial({
            color: 0x475569,
            metalness: 0.80,
            roughness: 0.25
          });
          const camBodyMesh = new THREE.Mesh(camBodyGeo, camBodyMat);
          camBodyMesh.position.set(0, -0.036, 0.042);
          armCameraGroup.add(camBodyMesh);

          // 3. Front Optical Glass Faceplate Bezel
          const bezelGeo = new THREE.BoxGeometry(0.086, 0.020, 0.002);
          const bezelMat = new THREE.MeshStandardMaterial({
            color: 0x090d16,
            roughness: 0.08,
            metalness: 0.95
          });
          const bezelMesh = new THREE.Mesh(bezelGeo, bezelMat);
          bezelMesh.position.set(0, -0.036, 0.0545);
          armCameraGroup.add(bezelMesh);

          // 4. Optical Sensor Lenses
          const irMat = new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            roughness: 0.1,
            metalness: 0.95
          });

          // Left IR Stereo sensor
          const irLeftGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 16);
          irLeftGeo.rotateX(Math.PI / 2);
          const irLeftMesh = new THREE.Mesh(irLeftGeo, irMat);
          irLeftMesh.position.set(-0.025, -0.036, 0.056);
          armCameraGroup.add(irLeftMesh);

          // Center RGB Camera Lens with anti-reflective optical coating sheen
          const rgbGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.004, 20);
          rgbGeo.rotateX(Math.PI / 2);
          const rgbMat = new THREE.MeshStandardMaterial({
            color: 0x1b2430,
            roughness: 0.05,
            metalness: 0.6
          });
          const rgbMesh = new THREE.Mesh(rgbGeo, rgbMat);
          rgbMesh.position.set(0, -0.036, 0.056);
          armCameraGroup.add(rgbMesh);

          // Right IR Projector lens
          const irRightGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 16);
          irRightGeo.rotateX(Math.PI / 2);
          const irRightMesh = new THREE.Mesh(irRightGeo, irMat);
          irRightMesh.position.set(0.025, -0.036, 0.056);
          armCameraGroup.add(irRightMesh);

          // 5. Glowing Camera Status LED
          const ledGeo = new THREE.SphereGeometry(0.002, 12, 12);
          const ledMat = new THREE.MeshBasicMaterial({ color: 0x3bd16f });
          const ledMesh = new THREE.Mesh(ledGeo, ledMat);
          ledMesh.position.set(0.035, -0.036, 0.056);
          armCameraGroup.add(ledMesh);
          cameraLedRef.current = ledMat;

          // 6. Camera Optical Sightline / Holographic Frustum Beam
          const frustumGroup = new THREE.Group();
          frustumGroup.visible = false;
          const fPoints = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(-0.14, -0.09, 0.40),
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0.14, -0.09, 0.40),
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(-0.14, 0.09, 0.40),
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0.14, 0.09, 0.40),
            // boundary box
            new THREE.Vector3(-0.14, -0.09, 0.40),
            new THREE.Vector3(0.14, -0.09, 0.40),
            new THREE.Vector3(0.14, -0.09, 0.40),
            new THREE.Vector3(0.14, 0.09, 0.40),
            new THREE.Vector3(0.14, 0.09, 0.40),
            new THREE.Vector3(-0.14, 0.09, 0.40),
            new THREE.Vector3(-0.14, 0.09, 0.40),
            new THREE.Vector3(-0.14, -0.09, 0.40)
          ];
          const frustumGeo = new THREE.BufferGeometry().setFromPoints(fPoints);
          const frustumMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3
          });
          const frustumLines = new THREE.LineSegments(frustumGeo, frustumMat);
          frustumLines.position.set(0, -0.036, 0.056);
          frustumGroup.add(frustumLines);
          armCameraGroup.add(frustumGroup);
          cameraFrustumRef.current = frustumGroup;

          gripperLink.add(armCameraGroup);
          armCameraGroupRef.current = armCameraGroup;
          armCameraGroup.traverse((o) => o.layers.set(1)); // the sensor's own housing is not in its view

          const wristCam = new WristCamera(renderer, scene, armCameraGroup, () => objectMeshesRef.current);
          wristCamRef.current = wristCam;
          // Perception reads rendered frames: what the camera does not see, the robot does not know.
          const visionCfg = () => ({
            tableY: rosService.robotBasePos.y,
            base: { x: rosService.robotBasePos.x, z: rosService.robotBasePos.z }
          });
          rosService.setPerceptionProvider(async () => {
            const frame = wristCam.capture();
            await annotate(frame, visionCfg()); // OpenCV segmentation + classifier, from pixels only
            cameraFeed.publish(frame);
            return frame;
          });
        }

        scene.add(robot);
        robotRef.current = robot;

        const initPos = rosService.getCurrentJointPositions();
        const jNames = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'gripper_joint'];
        jNames.forEach((name, idx) => {
          if (typeof initPos[idx] === 'number') {
            try {
              if (robot.joints && robot.joints[name]) {
                robot.joints[name].setJointValue(initPos[idx]);
              } else {
                robot.setJointValue(name, initPos[idx]);
              }
            } catch (e) {
              // ignore
            }
          }
        });

        setLoading(false);
      },
      undefined,
      (err) => {
        console.error('Failed to load URDF:', err);
        setLoadError('Failed to load URDF model');
        setLoading(false);
      }
    );

    // 12. Subscriptions
    const unsubscribeJoints = rosService.onJointStates((js: JointState) => {
      const robot = robotRef.current;
      if (!robot) return;

      js.names.forEach((name, idx) => {
        const val = js.positions[idx];
        if (typeof val === 'number') {
          try {
            if (name === 'gripper_joint' && simWorld.isReady) return; // fingers are posed from their rigid bodies below
            if (robot.joints && robot.joints[name]) {
              robot.joints[name].setJointValue(val);
            } else {
              robot.setJointValue(name, val);
            }
          } catch (e) {
            // ignore
          }
        }
      });
      if (simWorld.isReady) {
        const [xl, xr] = simWorld.fingerOffsets();
        robot.joints?.left_finger_joint?.setJointValue(xl + 0.0055);
        robot.joints?.right_finger_joint?.setJointValue(xr - 0.0055);
      }
    });

    const unsubscribeObjectsChange = rosService.onObjectsChange((objects) => {
      setTableObjects([...objects]);
      syncMeshes(objects);
    });

    const unsubscribeObjectEvent = rosService.onObjectEvent((event) => {
      setTableObjects([...rosService.getObjects()]);
      if (event.position) {
        objectPositionsRef.current[event.name] = event.position;
        setLivePositions({ ...objectPositionsRef.current });
      }
    });

    const unsubscribePositions = rosService.onObjectPositionChange((pos) => {
      objectPositionsRef.current = { ...pos };
      setLivePositions({ ...pos });
    });

    const unsubscribeScan = rosService.onPerceptionScan((evt) => {
      setScanEvent(evt);
      if (evt.active) {
        if (scanGroupRef.current) scanGroupRef.current.visible = true;
        if (cameraFrustumRef.current) cameraFrustumRef.current.visible = true;
        if (cameraLedRef.current) cameraLedRef.current.color.setHex(0x4da3ff);
        if (targetReticleRef.current) targetReticleRef.current.visible = false;
      } else {
        if (typeof evt.detectedCount === 'number') {
          setCameraPerceivedCount(evt.detectedCount);
        }
        if (evt.detectedPosition) {
          if (scanGroupRef.current) scanGroupRef.current.visible = false;
          if (cameraFrustumRef.current) cameraFrustumRef.current.visible = false;
          if (cameraLedRef.current) cameraLedRef.current.color.setHex(0x3bd16f);
          if (targetReticleRef.current) {
            targetReticleRef.current.position.set(
              evt.detectedPosition.x,
              evt.detectedPosition.y,
              evt.detectedPosition.z
            );
            targetReticleRef.current.visible = true;
            setTimeout(() => {
              if (targetReticleRef.current) targetReticleRef.current.visible = false;
            }, 2400);
          }
        } else {
          if (scanGroupRef.current) scanGroupRef.current.visible = false;
          if (cameraFrustumRef.current) cameraFrustumRef.current.visible = false;
          if (cameraLedRef.current) cameraLedRef.current.color.setHex(0x3bd16f);
        }
      }
    });

    const unsubscribeEStop = rosService.onEStopChange((stopped) => {
      setIsEStopped(stopped);
    });

    const unsubscribeSpeech = rosService.onArmSpeech((evt) => {
      setArmSpeech(evt);
      // Auto-clear after 7.5 seconds unless dismissed or replaced
      setTimeout(() => {
        setArmSpeech((curr) => (curr === evt ? null : curr));
      }, 7500);
    });

    const unsubscribeGuardrail = rosService.onGuardrail((evt) => {
      setGuardrailEvent(evt);
      if (evt) {
        setTimeout(() => {
          setGuardrailEvent((curr) => (curr === evt ? null : curr));
        }, 8500);
      }
    });

    // 13. Interactive Drag & Drop Raycasting for ANY object
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -surfaceY);
    const planeIntersection = new THREE.Vector3();

    const getInteractiveMeshes = (): THREE.Object3D[] => {
      return Object.values(objectMeshesRef.current).filter(Boolean);
    };

    const getObjectNameFromMesh = (mesh: THREE.Object3D): string | null => {
      let cur: THREE.Object3D | null = mesh;
      while (cur && cur !== scene) {
        if (cur.name && objectMeshesRef.current[cur.name]) {
          return cur.name;
        }
        cur = cur.parent;
      }
      return null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return; // Left click only
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(getInteractiveMeshes(), true);

      if (intersects.length > 0) {
        const hitObj = getObjectNameFromMesh(intersects[0].object);
        if (hitObj) {
          isDraggingRef.current = true;
          activeDragObjectRef.current = hitObj;
          simWorld.grab(hitObj);
          controls.enabled = false;
          setDraggingItem(hitObj);
          renderer.domElement.style.cursor = 'grabbing';
        }
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      if (isDraggingRef.current && activeDragObjectRef.current) {
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.ray.intersectPlane(tablePlane, planeIntersection)) {
          // Clamp within tabletop margins
          let x = Math.max(-0.55, Math.min(0.55, planeIntersection.x));
          let z = Math.max(-0.38, Math.min(0.38, planeIntersection.z));

          // Robot base clearance from side-mounted base
          const bx = rosService.robotBasePos.x;
          const bz = rosService.robotBasePos.z;
          const r = Math.hypot(x - bx, z - bz);
          if (r < 0.16) {
            const angle = Math.atan2(z - bz, x - bx);
            x = bx + Math.cos(angle) * 0.16;
            z = bz + Math.sin(angle) * 0.16;
          }

          simWorld.dragTo(activeDragObjectRef.current, x, z);
          setDragCoords({ x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) });
        }
      } else {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(getInteractiveMeshes(), true);
        if (intersects.length > 0) {
          renderer.domElement.style.cursor = 'grab';
        } else {
          renderer.domElement.style.cursor = 'default';
        }
      }
    };

    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        if (activeDragObjectRef.current) simWorld.release(activeDragObjectRef.current); // let go: it drops and settles
        activeDragObjectRef.current = null;
        controls.enabled = true;
        setDraggingItem(null);
        setDragCoords(null);
        renderer.domElement.style.cursor = 'default';
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    const pathMat = new THREE.LineBasicMaterial({ color: 0xe8e8ea, transparent: true, opacity: 0.85 });
    const pathLine = new THREE.Line(new THREE.BufferGeometry(), pathMat);
    pathLine.layers.set(1);
    pathLine.visible = false;
    pathLine.frustumCulled = false;
    scene.add(pathLine);
    let pathShownAt = 0;
    const unsubscribePath = topicBus.subscribe('/move_group/display_planned_path', (msg: any) => {
      if (!msg || !Array.isArray(msg.tcp_path)) return;
      const pts = msg.tcp_path.map((p: number[]) => new THREE.Vector3(p[0], p[1], p[2]));
      pathLine.geometry.dispose();
      pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      pathMat.color.setHex(msg.success ? 0xe8e8ea : 0xef5b52); // red = planner failed, direct move
      pathLine.visible = true;
      pathShownAt = performance.now();
    });

    const colliderLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false }));
    colliderLines.layers.set(1); // viewport only: the wrist camera never sees it
    colliderLines.frustumCulled = false;
    colliderLines.visible = false;
    scene.add(colliderLines);
    let lastStats = 0;

    // 14. Animation Loop
    let lastCamPreview = 0;
    let previewBusy = false;
    let animationFrameId: number;
    let scanAngle = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();

      if (pathLine.visible) {
        const age = performance.now() - pathShownAt;
        if (age > 7000) pathLine.visible = false;
        else pathMat.opacity = age < 5000 ? 0.85 : 0.85 * (1 - (age - 5000) / 2000);
      }
      // Live preview for the Sensors panel (only rendered while a panel is listening)
      if (wristCamRef.current && cameraFeed.hasSubscribers && !previewBusy && performance.now() - lastCamPreview > 300) {
        lastCamPreview = performance.now();
        previewBusy = true;
        const frame = wristCamRef.current.capture();
        annotate(frame, {
          tableY: rosService.robotBasePos.y,
          base: { x: rosService.robotBasePos.x, z: rosService.robotBasePos.z }
        })
          .then(() => cameraFeed.publish(frame))
          .catch(() => undefined)
          .finally(() => {
            previewBusy = false;
          });
      }

      let gripPos: THREE.Vector3 | null = null;
      if (robotRef.current) {
        const grip =
          robotRef.current.getObjectByName('gripper_link') ||
          robotRef.current.getObjectByName('link6');
        if (grip) {
          gripPos = new THREE.Vector3();
          // TCP between the finger pads is at local z = +0.115 m in gripper_link (see nora_arm.urdf)
          grip.localToWorld(gripPos.set(0, 0, 0.115));

          if (scanGroupRef.current && scanGroupRef.current.visible) {
            scanAngle += 0.04;
            scanGroupRef.current.position.copy(gripPos);
            scanGroupRef.current.rotation.y = scanAngle;
          }
        }
      }

      if (targetReticleRef.current && targetReticleRef.current.visible) {
        targetReticleRef.current.rotation.y += 0.03;
      }

      // Every object mesh is drawn exactly where its rigid body is.
      const meshes = objectMeshesRef.current;
      for (const k of Object.keys(meshes)) {
        const mesh = meshes[k];
        if (!mesh) continue;
        const p = simWorld.pose(k);
        if (p) {
          mesh.position.set(p.x, p.y, p.z);
          mesh.quaternion.set(p.qx, p.qy, p.qz, p.qw);
        }
        const sh = shadows[k];
        if (sh) {
          const ground = simWorld.surfaceAt(mesh.position.x, mesh.position.z);
          const lift = Math.max(0, mesh.position.y - ground - 0.06);
          sh.position.set(mesh.position.x, ground + 0.0008, mesh.position.z);
          (sh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.1, 1 - lift * 5);
          sh.scale.setScalar(1 + lift * 2);
        }
      }

      // Collision-shape overlay straight from the physics engine
      colliderLines.visible = showCollidersRef.current;
      if (showCollidersRef.current) {
        const dbg = simWorld.debugRender();
        if (dbg) {
          colliderLines.geometry.setAttribute('position', new THREE.BufferAttribute(dbg.vertices, 3));
          colliderLines.geometry.setAttribute('color', new THREE.BufferAttribute(dbg.colors, 4));
        }
      }
      if (performance.now() - lastStats > 500) {
        lastStats = performance.now();
        if (simWorld.isReady) {
          setPhysStats({ rtf: simWorld.realTimeFactor, stepMs: simWorld.stepMs, bodies: simWorld.bodyCount });
          setGripSensor(readGripSensor());
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    // 15. Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      cancelAnimationFrame(animationFrameId);
      unsubscribeJoints();
      unsubscribeObjectsChange();
      unsubscribeObjectEvent();
      unsubscribePositions();
      unsubscribeScan();
      unsubscribeEStop();
      unsubscribeSpeech();
      unsubscribeGuardrail();
      unsubscribePath();
      rosService.setPerceptionProvider(null);
      wristCamRef.current?.dispose();
      wristCamRef.current = null;
      pathLine.geometry.dispose();
      pathMat.dispose();
      colliderLines.geometry.dispose();
      (colliderLines.material as THREE.Material).dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      Object.keys(objectMeshesRef.current).forEach((id) => {
        const m = objectMeshesRef.current[id];
        if (m) {
          m.traverse((child: any) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach((mat: any) => mat.dispose());
              else child.material.dispose();
            }
          });
        }
      });
      objectMeshesRef.current = {};
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, []);

  const resetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(1.65, 1.55, 1.85); // Zoomed out perspective framing table and side-mounted arm
      controlsRef.current.target.set(-0.05, 0.46, 0.04);
      controlsRef.current.update();
    }
  };

  const toggleGrid = () => {
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = !gridHelperRef.current.visible;
      setShowGrid(gridHelperRef.current.visible);
    }
  };

  const friendlyName = (raw?: string | null) => {
    if (!raw) return 'Target';
    return raw.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="three-viewport-container">
      <div ref={mountRef} className="three-canvas" />

      {/* Floating Viewport Controls Toolbar */}
      <div className="viewport-overlay-toolbar">
        <button
          onClick={() => setIsAddModalOpen(true)}
          title="Spawn new physical objects on tabletop"
          className="viewport-btn highlight-btn btn-add-obj"
        >
          <Plus size={14} />
          <span>Add Object</span>
        </button>

        <button
          onClick={() => rosService.randomizeObjects()}
          title="Scatter tabletop objects anywhere randomly"
          className="viewport-btn"
        >
          <Shuffle size={14} />
          <span>Scatter</span>
        </button>

        <button
          onClick={() => rosService.resetObjects()}
          title="Reset Tabletop Workspace Items to Default"
          className="viewport-btn"
        >
          <RefreshCw size={13} />
          <span>Reset Layout</span>
        </button>

        <button
          onClick={toggleGrid}
          title="Toggle Ground Grid"
          className={`viewport-btn ${showGrid ? 'active' : ''}`}
        >
          <Grid size={14} />
          <span>Grid</span>
        </button>

        <button
          onClick={() => {
            showCollidersRef.current = !showCollidersRef.current;
            setShowColliders(showCollidersRef.current);
          }}
          title="Show the collision shapes the physics engine is simulating"
          className={`viewport-btn ${showColliders ? 'active' : ''}`}
        >
          <Boxes size={14} />
          <span>Colliders</span>
        </button>

        <button
          onClick={resetCamera}
          title="Reset Camera View (Zoomed Out)"
          className="viewport-btn"
        >
          <RotateCcw size={14} />
          <span>Reset Cam</span>
        </button>

        <div className="viewport-toolbar-divider" />

        {/* Viewport Stop Button */}
        <button
          onClick={() => {
            if (isEStopped) rosService.resetEmergencyStop();
            else rosService.emergencyStop();
          }}
          title={isEStopped ? 'Safety interlock engaged: Click to reset and resume' : 'Instant Stop / E-Stop: Freeze arm in place'}
          className={`viewport-btn btn-viewport-stop ${isEStopped ? 'active-stop' : ''}`}
        >
          {isEStopped ? <Play size={13} /> : <Square size={13} />}
          <span>{isEStopped ? 'Resume' : 'Stop'}</span>
        </button>

        {/* Viewport Cancel Button */}
        <button
          onClick={() => rosService.cancelTask()}
          title="Cancel active plan, abort execution, and return arm home"
          className="viewport-btn btn-viewport-cancel"
        >
          <XCircle size={14} />
          <span>Cancel</span>
        </button>
      </div>

      {physStats && (
        <div
          title="Rigid-body physics: fixed 240 Hz step. A real-time factor below 1.00 means this device cannot keep up, so the simulation runs slow rather than skipping steps."
          style={{ position: 'absolute', right: 12, bottom: 12, font: '11px ui-monospace, monospace', color: '#9aa3ad', background: 'rgba(20,22,25,0.72)', padding: '4px 8px', borderRadius: 6 }}
        >
          physics 240 Hz · {physStats.stepMs.toFixed(2)} ms/step · {physStats.rtf.toFixed(2)}x real time · {physStats.bodies} bodies
        </div>
      )}

      {/* On-Arm Eye-in-Hand Camera HUD */}
      <div className={`on-arm-camera-hud ${scanEvent?.active ? 'scanning' : 'standby'}`}>
        <div className="camera-lens-indicator">
          <div className={`camera-led-dot ${scanEvent?.active ? 'active' : ''}`} />
          <Camera size={14} className="camera-icon-hud" />
        </div>
        <div className="camera-hud-info">
          <div className="camera-hud-title">
            <span className="camera-brand">WRIST CAMERA</span>
            <span className={`camera-status-tag ${scanEvent?.active ? 'active' : 'standby'}`}>
              {scanEvent?.active
                ? scanEvent.scanMode === 'verification_survey'
                  ? 'RE-CHECK'
                  : 'LOOKING'
                : 'IDLE'}
            </span>
          </div>
          <div className="camera-hud-meta">
            <span className="camera-spec">Simulated RGB-D · 256×144 · 69°×42°</span>
            <span className="camera-obj-count">
              {scanEvent?.active ? (
                <span style={{ color: 'var(--cyan)' }}>
                  {scanEvent.scanMode === 'verification_survey'
                    ? 'Checking the table again'
                    : 'Moving between viewpoints'}
                </span>
              ) : cameraPerceivedCount !== null ? (
                <span>
                  Last survey: <strong>{cameraPerceivedCount}</strong> object{cameraPerceivedCount !== 1 ? 's' : ''} seen
                </span>
              ) : (
                <span style={{ opacity: 0.75 }}>No survey yet</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Emergency Stop Active Banner */}
      {isEStopped && (
        <div className="viewport-estop-banner">
          <AlertOctagon size={18} className="estop-pulse" />
          <div className="viewport-estop-text">
            <strong>EMERGENCY STOP ACTIVE</strong>
            <span>All actuators locked & motion aborted. Press "RESET E-STOP" to resume.</span>
          </div>
          <button
            onClick={() => rosService.resetEmergencyStop()}
            className="btn-estop-reset-banner"
          >
            Reset Interlock
          </button>
        </div>
      )}

      {/* Task status and live simulated fingertip readings. */}
      {armSpeech && (
        <div className={`viewport-speech-bubble ${armSpeech.type}`}>
          <div className="speech-body">
            <div className="speech-tag-row">
              <span className="speech-tag">{armSpeech.type === 'info' ? 'Status' : 'Refused'}</span>
            </div>
            <div className="speech-message">{armSpeech.message}</div>
            {armSpeech.subtext && <div className="speech-subtext">{armSpeech.subtext}</div>}
            {gripSensor?.pinched && <div className="speech-grip-reading">
              <span>{gripSensor.supported ? 'Surface contact' : gripSensor.slipSpeed > 0.005 ? 'Slipping' : 'Holding'}</span>
              <span>L {gripSensor.squeezeLeft.toFixed(1)} N / R {gripSensor.squeezeRight.toFixed(1)} N</span>
              <span>Slip {(gripSensor.slipSpeed * 1000).toFixed(1)} mm/s</span>
            </div>}
          </div>
          <button
            className="speech-dismiss-btn"
            onClick={() => setArmSpeech(null)}
            title="Dismiss speech"
          >
            ✕
          </button>
        </div>
      )}

      {/* SayCan Guardrail Block HUD Banner */}
      {guardrailEvent && (
        <div className="viewport-guardrail-banner">
          <div className="guardrail-hud-badge">
            <ShieldAlert size={20} className="guardrail-hud-icon" />
          </div>
          <div className="guardrail-hud-body">
            <div className="guardrail-hud-header">
              <span className="guardrail-hud-title">{guardrailEvent.title}</span>
              <span className="guardrail-hud-tag">SayCan Policy Interlock</span>
            </div>
            <div className="guardrail-hud-reason">{guardrailEvent.reason}</div>
            <div className="guardrail-hud-metrics">
              <span className="metric-chip">
                Affordance Score: <strong className="val-zero">{guardrailEvent.score.toFixed(3)}</strong>
              </span>
              <span className="metric-chip">
                Min Threshold: <strong>{guardrailEvent.threshold.toFixed(2)}</strong>
              </span>
              <span className="metric-chip status-blocked">
                Motion Interlocked (0° Delta)
              </span>
            </div>
          </div>
          <button
            className="guardrail-hud-close"
            onClick={() => setGuardrailEvent(null)}
            title="Dismiss guardrail alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* Dragging Coordinates Tooltip with Real-Time Reachability Feedback */}
      {draggingItem && dragCoords && (() => {
        const distFromBase = Math.hypot(
          dragCoords.x - rosService.robotBasePos.x,
          dragCoords.z - rosService.robotBasePos.z
        );
        const isReachable = checkReach(
          dragCoords.x,
          rosService.robotBasePos.y + GRASP_MIN_TCP_HEIGHT + 0.005,
          dragCoords.z,
          rosService.robotBasePos
        ).reachable;
        return (
          <div className={`viewport-drag-tooltip ${isReachable ? 'reachable' : 'unreachable'}`}>
            <Move size={13} />
            <span>
              {friendlyName(draggingItem)}: X: {dragCoords.x.toFixed(2)}m, Z: {dragCoords.z.toFixed(2)}m (dist: {distFromBase.toFixed(2)}m)
            </span>
            <span className={`drag-reach-badge ${isReachable ? 'badge-ok' : 'badge-warn'}`}>
              {isReachable ? 'Reachable' : `⚠️ Out of reach (>${MAX_TABLE_REACH.toFixed(2)}m)`}
            </span>
          </div>
        );
      })()}

      {/* Sleek Floating Tabletop HUD (Clean, uncluttered, expandable) */}
      <div className="tabletop-hud-container">
        <div className="tabletop-hud-bar">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="hud-btn hud-btn-add"
            title="Spawn a new custom physical object on tabletop"
          >
            <Plus size={15} />
            <span>Add Object</span>
          </button>

          {/* Objects Popover Toggle */}
          <button
            onClick={() => setShowObjectsPopover(!showObjectsPopover)}
            className={`hud-btn hud-btn-objects ${showObjectsPopover ? 'active' : ''}`}
            title="Inspect tabletop objects & live coordinates"
          >
            <Box size={14} />
            <span>{tableObjects.length} Objects</span>
            {showObjectsPopover ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>

          {/* Quick Clear All / Restore Defaults button directly on HUD */}
          {tableObjects.length > 0 ? (
            <button
              type="button"
              onClick={() => rosService.clearAllObjects()}
              className="hud-btn hud-btn-clear"
              title="Remove all objects from tabletop (including defaults)"
            >
              <Trash2 size={13} />
              <span>Delete All</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => rosService.resetToDefaultObjects()}
              className="hud-btn hud-btn-restore"
              title="Restore default tabletop items (Red Cube, Blue Cylinder, Green Sphere, Water Glass)"
            >
              <RotateCcw size={13} />
              <span>Restore Defaults</span>
            </button>
          )}

          <div className="hud-divider" />

          {/* Quick Spawn Pill Strip */}
          <div className="hud-quick-strip">
            <span className="hud-mini-label">Quick:</span>
            <button
              type="button"
              onClick={() => handleQuickSpawn('Coffee Mug', 'mug', '#8B4513')}
              className="hud-quick-btn"
              title="Quick Add: Ceramic Coffee Mug"
            >
              ☕
            </button>
            <button
              type="button"
              onClick={() => handleQuickSpawn('Red Apple', 'apple', '#e11d48')}
              className="hud-quick-btn"
              title="Quick Add: Fresh Red Apple"
            >
              🍎
            </button>
            <button
              type="button"
              onClick={() => handleQuickSpawn('Writing Pen', 'cylinder', '#2563eb')}
              className="hud-quick-btn"
              title="Quick Add: Blue Writing Pen"
            >
              🖊️
            </button>
            <button
              type="button"
              onClick={() => handleQuickSpawn('Water Glass', 'glass', '#38bdf8')}
              className="hud-quick-btn"
              title="Quick Add: Clear Water Glass"
            >
              🥤
            </button>
            <button
              type="button"
              onClick={() => handleQuickSpawn('Tennis Ball', 'sphere', '#84cc16')}
              className="hud-quick-btn"
              title="Quick Add: Tennis Ball"
            >
              🎾
            </button>
            <button
              type="button"
              onClick={() => handleQuickSpawn('Package Box', 'box', '#f59e0b')}
              className="hud-quick-btn"
              title="Quick Add: Package Box"
            >
              📦
            </button>
          </div>
        </div>

        {/* Popover showing detailed items list & coordinates when toggled */}
        {showObjectsPopover && (
          <div className="tabletop-objects-popover">
            <div className="popover-header">
              <div className="popover-title-row">
                <Box size={14} className="icon-cyan" />
                <span className="popover-title">Tabletop Objects ({tableObjects.length})</span>
              </div>
              <div className="popover-actions-row">
                {tableObjects.length > 0 ? (
                  <button
                    className="btn-popover-clear-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      rosService.clearAllObjects();
                    }}
                    title="Remove all objects from the tabletop"
                  >
                    <Trash2 size={11} />
                    <span>Clear All</span>
                  </button>
                ) : (
                  <button
                    className="btn-popover-restore"
                    onClick={(e) => {
                      e.stopPropagation();
                      rosService.resetToDefaultObjects();
                    }}
                    title="Restore default tabletop items"
                  >
                    <RotateCcw size={11} />
                    <span>Reset Defaults</span>
                  </button>
                )}
                <span className="popover-tip">💡 Drag in 3D</span>
              </div>
            </div>

            <div className="popover-objects-grid">
              {tableObjects.length === 0 ? (
                <div className="popover-empty-notice">
                  <span>Tabletop is empty. Click <strong>+ Add Object</strong> or quick pills above to place items.</span>
                </div>
              ) : (
                tableObjects.map((obj) => {
                  const pos = livePositions[obj.id] || obj.position;
                  return (
                    <div
                      key={obj.id}
                      className="popover-obj-item"
                      title={`${obj.name} (X: ${pos.x.toFixed(2)}m, Z: ${pos.z.toFixed(2)}m)`}
                    >
                      <span className="dot" style={{ backgroundColor: obj.color }} />
                      <span className="popover-obj-name">{obj.name}</span>
                      <span className="popover-obj-coords">
                        ({pos.x.toFixed(2)}, {pos.z.toFixed(2)})
                      </span>
                      <button
                        className="btn-delete-obj"
                        onClick={(e) => {
                          e.stopPropagation();
                          rosService.removeObject(obj.id);
                        }}
                        title={`Delete ${obj.name}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Object Modal */}
      <AddObjectModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onObjectAdded={() => {
          setTableObjects(rosService.getObjects());
        }}
      />

      {loading && (
        <div className="three-loading-spinner">
          <div className="spinner-ring" />
          <span>Loading NORA 3D Arm URDF...</span>
        </div>
      )}

      {loadError && (
        <div className="three-error-overlay">
          <span>{loadError}</span>
        </div>
      )}
    </div>
  );
};
