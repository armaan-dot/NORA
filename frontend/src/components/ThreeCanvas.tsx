import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { rosService } from '../services/rosService';
import type { ArmSpeechEvent, GuardrailEvent, JointState, ObjectPosition, PerceptionScanEvent, TabletopObject } from '../types';
import { AddObjectModal } from './AddObjectModal';
import {
  RotateCcw,
  Grid,
  RefreshCw,
  Shuffle,
  Move,
  Scan,
  Plus,
  Trash2,
  AlertOctagon,
  Box,
  ChevronDown,
  ChevronUp,
  Square,
  Play,
  XCircle,
  ShieldAlert
} from 'lucide-react';

export const ThreeCanvas: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const robotRef = useRef<URDFRobot | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const objectGroupRef = useRef<THREE.Group | null>(null);

  // Dynamic mesh references
  const objectMeshesRef = useRef<Record<string, THREE.Object3D>>({});
  const objectStatesRef = useRef<Record<string, 'table' | 'held' | 'tray' | 'user'>>({});
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
  const [draggingItem, setDraggingItem] = useState<string | null>(null);
  const [dragCoords, setDragCoords] = useState<{ x: number; z: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
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

  // Helper to construct 3D mesh based on object properties
  const createObjectMesh = (obj: TabletopObject, surfaceY: number): THREE.Object3D => {
    let mesh: THREE.Object3D;
    const colorHex = parseInt(obj.color.replace('#', '0x'), 16) || 0x3b82f6;
    const nameLower = obj.name.toLowerCase();
    const isMug = obj.shape === 'mug' || nameLower.includes('mug') || nameLower.includes('coffee');
    const isApple = obj.shape === 'apple' || nameLower.includes('apple') || nameLower.includes('fruit');

    if (isMug) {
      const mugGroup = new THREE.Group();
      // Outer Ceramic Mug Cylinder
      const mugGeo = new THREE.CylinderGeometry(0.038, 0.032, 0.085, 24);
      const mugMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.18,
        metalness: 0.15
      });
      const mugBody = new THREE.Mesh(mugGeo, mugMat);
      mugBody.castShadow = true;
      mugBody.receiveShadow = true;
      mugGroup.add(mugBody);

      // Dark Rich Coffee Liquid inside
      const coffeeGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.005, 24);
      const coffeeMat = new THREE.MeshStandardMaterial({
        color: 0x24140e,
        roughness: 0.1,
        metalness: 0.1
      });
      const coffeeLiquid = new THREE.Mesh(coffeeGeo, coffeeMat);
      coffeeLiquid.position.y = 0.036;
      mugGroup.add(coffeeLiquid);

      // Side Ceramic Handle (Torus)
      const handleGeo = new THREE.TorusGeometry(0.022, 0.0055, 12, 24, Math.PI * 1.15);
      const handleMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.18,
        metalness: 0.15
      });
      const handle = new THREE.Mesh(handleGeo, handleMat);
      handle.position.set(0.036, 0.0, 0.0);
      handle.rotation.z = -Math.PI / 2;
      handle.castShadow = true;
      mugGroup.add(handle);

      mesh = mugGroup;
    } else if (isApple) {
      const appleGroup = new THREE.Group();
      const appleGeo = new THREE.SphereGeometry(0.036, 24, 24);
      const appleMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.25,
        metalness: 0.1
      });
      const appleBody = new THREE.Mesh(appleGeo, appleMat);
      appleBody.castShadow = true;
      appleBody.receiveShadow = true;
      appleGroup.add(appleBody);

      // Stem
      const stemGeo = new THREE.CylinderGeometry(0.0025, 0.0025, 0.015, 8);
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x3d2817 });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.y = 0.038;
      stem.rotation.z = 0.2;
      appleGroup.add(stem);

      // Leaf
      const leafGeo = new THREE.ConeGeometry(0.006, 0.016, 6);
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x16a34a });
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(0.006, 0.039, 0);
      appleGroup.add(leaf);

      mesh = appleGroup;
    } else if (nameLower.includes('tennis')) {
      const tennisGroup = new THREE.Group();
      const ballGeo = new THREE.SphereGeometry(0.035, 32, 32);
      const ballMat = new THREE.MeshStandardMaterial({
        color: 0xc4e538, // iconic tennis ball chartreuse
        roughness: 0.9,
        metalness: 0.05
      });
      const ballBody = new THREE.Mesh(ballGeo, ballMat);
      ballBody.castShadow = true;
      ballBody.receiveShadow = true;
      tennisGroup.add(ballBody);

      // Characteristic curved white seams
      const seamGeo = new THREE.TorusGeometry(0.0353, 0.0016, 8, 36);
      const seamMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const seam1 = new THREE.Mesh(seamGeo, seamMat);
      seam1.rotation.x = Math.PI / 4;
      seam1.rotation.y = Math.PI / 4;
      tennisGroup.add(seam1);

      const seam2 = new THREE.Mesh(seamGeo, seamMat);
      seam2.rotation.x = -Math.PI / 4;
      seam2.rotation.y = -Math.PI / 4;
      tennisGroup.add(seam2);

      mesh = tennisGroup;
    } else if (nameLower.includes('pen') || nameLower.includes('pencil') || nameLower.includes('marker')) {
      const penGroup = new THREE.Group();
      // Pen slender body
      const penGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.11, 16);
      const penMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.25,
        metalness: 0.35
      });
      const penBody = new THREE.Mesh(penGeo, penMat);
      penBody.castShadow = true;
      penBody.receiveShadow = true;
      penGroup.add(penBody);

      // Silver clip on cap
      const clipGeo = new THREE.BoxGeometry(0.004, 0.03, 0.007);
      const clipMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.85, roughness: 0.2 });
      const clip = new THREE.Mesh(clipGeo, clipMat);
      clip.position.set(0.007, 0.035, 0);
      penGroup.add(clip);

      // Silver conical tip
      const tipGeo = new THREE.ConeGeometry(0.007, 0.018, 16);
      const tip = new THREE.Mesh(tipGeo, clipMat);
      tip.position.y = -0.064;
      tip.rotation.x = Math.PI;
      penGroup.add(tip);

      mesh = penGroup;
    } else if (nameLower.includes('scissor') || nameLower.includes('shears')) {
      const scissorGroup = new THREE.Group();
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        metalness: 0.95,
        roughness: 0.15
      });
      const handleMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.35,
        metalness: 0.2
      });

      // Left blade
      const blade1Geo = new THREE.BoxGeometry(0.0035, 0.085, 0.011);
      const blade1 = new THREE.Mesh(blade1Geo, bladeMat);
      blade1.position.set(-0.007, 0.018, 0.001);
      blade1.rotation.z = -0.22;
      blade1.castShadow = true;
      blade1.receiveShadow = true;
      scissorGroup.add(blade1);

      // Right blade
      const blade2Geo = new THREE.BoxGeometry(0.0035, 0.085, 0.011);
      const blade2 = new THREE.Mesh(blade2Geo, bladeMat);
      blade2.position.set(0.007, 0.018, -0.001);
      blade2.rotation.z = 0.22;
      blade2.castShadow = true;
      blade2.receiveShadow = true;
      scissorGroup.add(blade2);

      // Pivot rivet
      const rivetGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.008, 16);
      const rivet = new THREE.Mesh(rivetGeo, bladeMat);
      rivet.rotation.x = Math.PI / 2;
      rivet.position.set(0, -0.005, 0);
      scissorGroup.add(rivet);

      // Handle loop 1
      const ring1Geo = new THREE.TorusGeometry(0.013, 0.0032, 12, 24);
      const ring1 = new THREE.Mesh(ring1Geo, handleMat);
      ring1.position.set(-0.016, -0.038, 0);
      ring1.castShadow = true;
      scissorGroup.add(ring1);

      // Handle loop 2
      const ring2Geo = new THREE.TorusGeometry(0.013, 0.0032, 12, 24);
      const ring2 = new THREE.Mesh(ring2Geo, handleMat);
      ring2.position.set(0.016, -0.038, 0);
      ring2.castShadow = true;
      scissorGroup.add(ring2);

      mesh = scissorGroup;
    } else if (nameLower.includes('stapler')) {
      const staplerGroup = new THREE.Group();
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.85,
        roughness: 0.25
      });
      const topMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.3,
        metalness: 0.25
      });

      // Bottom anvil base
      const baseGeo = new THREE.BoxGeometry(0.03, 0.008, 0.09);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.castShadow = true;
      base.receiveShadow = true;
      staplerGroup.add(base);

      // Upper arm lever
      const topGeo = new THREE.BoxGeometry(0.026, 0.02, 0.082);
      const topLever = new THREE.Mesh(topGeo, topMat);
      topLever.position.set(0, 0.015, -0.004);
      topLever.rotation.x = 0.05;
      topLever.castShadow = true;
      topLever.receiveShadow = true;
      staplerGroup.add(topLever);

      mesh = staplerGroup;
    } else if (obj.shape === 'box') {
      const geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.25,
        metalness: 0.2
      });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      mesh = m;
    } else if (obj.shape === 'cylinder') {
      const geo = new THREE.CylinderGeometry(0.035, 0.035, 0.09, 32);
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.25,
        metalness: 0.45
      });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      mesh = m;
    } else if (obj.shape === 'sphere') {
      const geo = new THREE.SphereGeometry(0.035, 32, 32);
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.2,
        metalness: 0.35
      });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      mesh = m;
    } else {
      // Glass / Cup group
      const glassGroup = new THREE.Group();
      const glassGeo = new THREE.CylinderGeometry(0.035, 0.028, 0.11, 24, 1, true);
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.45,
        roughness: 0.05,
        transmission: 0.9,
        thickness: 0.02
      });
      const glassMesh = new THREE.Mesh(glassGeo, glassMat);
      glassMesh.castShadow = true;
      glassGroup.add(glassMesh);

      const fluidGeo = new THREE.CylinderGeometry(0.032, 0.026, 0.08, 24);
      const fluidMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.85,
        roughness: 0.1
      });
      const fluidMesh = new THREE.Mesh(fluidGeo, fluidMat);
      fluidMesh.position.y = -0.01;
      glassGroup.add(fluidMesh);
      mesh = glassGroup;
    }

    mesh.name = obj.id;
    const posY = obj.position?.y ?? surfaceY + 0.03;
    mesh.position.set(obj.position.x, posY, obj.position.z);
    return mesh;
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0a0d14);
    scene.fog = new THREE.FogExp2(0x0a0d14, 0.22);

    // 2. Camera setup - Zoomed out default view for clear perspective
    const width = container.clientWidth;
    const height = container.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    camera.position.set(1.65, 1.55, 1.85); // Zoomed out perspective framing table and side-mounted arm
    cameraRef.current = camera;

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 4. Controls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(-0.05, 0.46, 0.04); // Focus at center of tabletop workspace
    controls.maxPolarAngle = Math.PI / 2 + 0.05;
    controls.minDistance = 0.5;
    controls.maxDistance = 6.0;
    controlsRef.current = controls;

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.25);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
    dirLight.position.set(3.2, 5.2, 2.6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const accentLight = new THREE.PointLight(0x00f0ff, 1.6, 5);
    accentLight.position.set(-1.2, 1.2, -1.2);
    scene.add(accentLight);

    // 6. Ground Grid & Floor
    const grid = new THREE.GridHelper(6, 30, 0x00d2ff, 0x1a2333);
    grid.position.y = -0.001;
    scene.add(grid);
    gridHelperRef.current = grid;

    const floorGeo = new THREE.PlaneGeometry(12, 12);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x080a0f,
      roughness: 0.9,
      metalness: 0.1
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // 7. Table Setup
    const tableHeight = 0.45;
    const tableTopThickness = 0.04;
    const tableWidth = 1.3;
    const tableDepth = 0.9;

    const tableGroup = new THREE.Group();

    // Tabletop
    const tabletopGeo = new THREE.BoxGeometry(tableWidth, tableTopThickness, tableDepth);
    const tabletopMat = new THREE.MeshStandardMaterial({
      color: 0x1e2533,
      roughness: 0.35,
      metalness: 0.35
    });
    const tabletop = new THREE.Mesh(tabletopGeo, tabletopMat);
    tabletop.position.y = tableHeight - tableTopThickness / 2;
    tabletop.receiveShadow = true;
    tabletop.castShadow = true;
    tableGroup.add(tabletop);

    // Glowing cyan accent edge
    const edgeGeo = new THREE.BoxGeometry(tableWidth + 0.008, 0.004, tableDepth + 0.008);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
    const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
    edgeMesh.position.y = tableHeight;
    tableGroup.add(edgeMesh);

    // 4 Table Legs
    const legGeo = new THREE.CylinderGeometry(0.025, 0.025, tableHeight - tableTopThickness, 16);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x121620, metalness: 0.7, roughness: 0.3 });
    const legOffsets = [
      [-tableWidth / 2 + 0.05, -tableDepth / 2 + 0.05],
      [tableWidth / 2 - 0.05, -tableDepth / 2 + 0.05],
      [-tableWidth / 2 + 0.05, tableDepth / 2 - 0.05],
      [tableWidth / 2 - 0.05, tableDepth / 2 - 0.05]
    ];
    legOffsets.forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, (tableHeight - tableTopThickness) / 2, lz);
      leg.castShadow = true;
      leg.receiveShadow = true;
      tableGroup.add(leg);
    });
    scene.add(tableGroup);

    const surfaceY = tableHeight;

    // 8. Table-Mounted Side Arm Clamp Hardware (Styled like a heavy-duty industrial desk lamp clamp!)
    const mountGroup = new THREE.Group();
    mountGroup.position.set(rosService.robotBasePos.x, surfaceY, rosService.robotBasePos.z);

    // Heavy-duty table-top flange base plate
    const flangeGeo = new THREE.CylinderGeometry(0.105, 0.11, 0.024, 32);
    const flangeMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.25
    });
    const flangeMesh = new THREE.Mesh(flangeGeo, flangeMat);
    flangeMesh.position.y = 0.012;
    flangeMesh.castShadow = true;
    flangeMesh.receiveShadow = true;
    mountGroup.add(flangeMesh);

    // Inner mounting collar ring with glowing cyan accent
    const collarGeo = new THREE.TorusGeometry(0.092, 0.006, 12, 32);
    const collarMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, roughness: 0.2, metalness: 0.8 });
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    collarMesh.rotation.x = Math.PI / 2;
    collarMesh.position.y = 0.024;
    mountGroup.add(collarMesh);

    // 4 Hex mounting bolts
    const boltGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.014, 6);
    const boltMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    const boltAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
    boltAngles.forEach((a) => {
      const bolt = new THREE.Mesh(boltGeo, boltMat);
      bolt.position.set(Math.cos(a) * 0.078, 0.026, Math.sin(a) * 0.078);
      mountGroup.add(bolt);
    });

    // Side clamp bracket reaching over the left edge of table
    const clampArmGeo = new THREE.BoxGeometry(0.18, 0.022, 0.08);
    const clampArmMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.3 });
    const clampArm = new THREE.Mesh(clampArmGeo, clampArmMat);
    clampArm.position.set(-0.10, 0.011, 0.0);
    clampArm.castShadow = true;
    mountGroup.add(clampArm);

    // Side edge plate gripping down the side edge of table
    const sideJawGeo = new THREE.BoxGeometry(0.025, 0.09, 0.08);
    const sideJaw = new THREE.Mesh(sideJawGeo, clampArmMat);
    sideJaw.position.set(-0.19, -0.025, 0.0);
    sideJaw.castShadow = true;
    mountGroup.add(sideJaw);

    // Bottom clamp jaw underneath the table
    const bottomJawGeo = new THREE.BoxGeometry(0.09, 0.02, 0.08);
    const bottomJaw = new THREE.Mesh(bottomJawGeo, clampArmMat);
    bottomJaw.position.set(-0.14, -0.07, 0.0);
    mountGroup.add(bottomJaw);

    // Tightening screw rod & knob underneath (authentic desk-lamp clamp!)
    const screwRodGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.045, 12);
    const screwRod = new THREE.Mesh(screwRodGeo, boltMat);
    screwRod.position.set(-0.14, -0.092, 0.0);
    mountGroup.add(screwRod);

    const knobGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.015, 16);
    const knob = new THREE.Mesh(knobGeo, flangeMat);
    knob.position.set(-0.14, -0.115, 0.0);
    mountGroup.add(knob);

    scene.add(mountGroup);

    // 9. Operator Handover Station Mat (User side of table)
    const handoverMatGeo = new THREE.BoxGeometry(0.24, 0.006, 0.18);
    const handoverMatMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.4
    });
    const handoverMat = new THREE.Mesh(handoverMatGeo, handoverMatMat);
    handoverMat.position.set(rosService.handoverPos.x, surfaceY + 0.003, rosService.handoverPos.z);
    handoverMat.receiveShadow = true;

    // Glowing emerald border around handover station
    const handoverBorderGeo = new THREE.EdgesGeometry(handoverMatGeo);
    const handoverBorder = new THREE.LineSegments(
      handoverBorderGeo,
      new THREE.LineBasicMaterial({ color: 0x10b981 })
    );
    handoverMat.add(handoverBorder);
    scene.add(handoverMat);

    // 10. Storage Tray
    const trayGeo = new THREE.BoxGeometry(0.18, 0.02, 0.18);
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.5 });
    const trayMesh = new THREE.Mesh(trayGeo, trayMat);
    trayMesh.position.set(-0.05, surfaceY + 0.01, -0.24);
    trayMesh.receiveShadow = true;
    scene.add(trayMesh);

    // 9. Object Group for Dynamic Workspace Items
    const objectGroup = new THREE.Group();
    scene.add(objectGroup);
    objectGroupRef.current = objectGroup;

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
          const newMesh = createObjectMesh(obj, surfaceY);
          objectGroupRef.current?.add(newMesh);
          objectMeshesRef.current[obj.id] = newMesh;
        }
        if (obj.state) {
          objectStatesRef.current[obj.id] = obj.state;
        }
        if (obj.position) {
          objectPositionsRef.current[obj.id] = { ...obj.position };
        }
      });
    };

    // Clear any previous scene mesh cache and initialize fresh
    objectMeshesRef.current = {};
    syncMeshes(rosService.getObjects());

    // 10. Visual Perception Scanner Cone & Target Reticle
    const scanGroup = new THREE.Group();
    scanGroup.visible = false;

    // Glowing holographic scan cone
    const scanConeGeo = new THREE.ConeGeometry(0.25, 0.45, 32, 1, true);
    scanConeGeo.rotateX(Math.PI);
    const scanConeMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.22,
      wireframe: true,
      side: THREE.DoubleSide
    });
    const scanConeMesh = new THREE.Mesh(scanConeGeo, scanConeMat);
    scanGroup.add(scanConeMesh);

    // Center focal laser beam
    const scanBeamGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.45, 12);
    const scanBeamMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const scanBeamMesh = new THREE.Mesh(scanBeamGeo, scanBeamMat);
    scanBeamMesh.position.y = -0.225;
    scanGroup.add(scanBeamMesh);

    scene.add(scanGroup);
    scanGroupRef.current = scanGroup;

    // Target locked HUD reticle
    const reticleGroup = new THREE.Group();
    reticleGroup.visible = false;
    const reticleGeo = new THREE.RingGeometry(0.045, 0.055, 32);
    reticleGeo.rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide
    });
    const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
    reticleGroup.add(reticleMesh);

    // Corner bounding brackets
    const boxHelperGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    const boxEdges = new THREE.EdgesGeometry(boxHelperGeo);
    const boxLines = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 })
    );
    reticleGroup.add(boxLines);

    scene.add(reticleGroup);
    targetReticleRef.current = reticleGroup;

    // 11. Load NORA URDF
    const loader = new URDFLoader();
    loader.load(
      '/nora_arm.urdf',
      (robot) => {
        robot.position.set(rosService.robotBasePos.x, surfaceY, rosService.robotBasePos.z);
        robot.rotation.x = -Math.PI / 2;

        robot.traverse((child: any) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

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
    });

    const unsubscribeObjectsChange = rosService.onObjectsChange((objects) => {
      setTableObjects([...objects]);
      syncMeshes(objects);
    });

    const unsubscribeObjectEvent = rosService.onObjectEvent((event) => {
      objectStatesRef.current[event.name] = event.state;
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
        if (targetReticleRef.current) targetReticleRef.current.visible = false;
      } else if (evt.detectedPosition) {
        if (scanGroupRef.current) scanGroupRef.current.visible = false;
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

          const objName = activeDragObjectRef.current;
          const oldY = objectPositionsRef.current[objName]?.y || surfaceY + 0.03;
          const newPos = { x: Number(x.toFixed(3)), y: oldY, z: Number(z.toFixed(3)) };

          objectPositionsRef.current[objName] = newPos;
          setDragCoords({ x: newPos.x, z: newPos.z });
          rosService.setObjectPosition(objName, newPos);
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

    // 14. Animation Loop
    let animationFrameId: number;
    let scanAngle = 0;

    const USER_POS = new THREE.Vector3(rosService.handoverPos.x, surfaceY + 0.035, rosService.handoverPos.z);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();

      let gripPos: THREE.Vector3 | null = null;
      if (robotRef.current) {
        const grip =
          robotRef.current.getObjectByName('gripper_link') ||
          robotRef.current.getObjectByName('link6');
        if (grip) {
          gripPos = new THREE.Vector3();
          // The finger pads are located at local z = +0.085m in gripper_link frame
          grip.localToWorld(gripPos.set(0, 0, 0.085));

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

      const meshes = objectMeshesRef.current;
      const states = objectStatesRef.current;
      const positions = objectPositionsRef.current;
      const keys = Object.keys(meshes);

      keys.forEach((k, idx) => {
        const mesh = meshes[k];
        if (!mesh) return;
        const st = states[k] || 'table';

        if (st === 'held' && gripPos) {
          mesh.position.copy(gripPos);
        } else if (st === 'tray') {
          // Dynamic tray slot layout so items don't collide
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const trayTarget = new THREE.Vector3(
            -0.08 + col * 0.065,
            surfaceY + 0.04,
            -0.27 + row * 0.06
          );
          mesh.position.lerp(trayTarget, 0.2);
        } else if (st === 'user') {
          mesh.position.lerp(USER_POS, 0.2);
        } else {
          const p = positions[k];
          if (p) {
            const targetVec = new THREE.Vector3(p.x, p.y, p.z);
            mesh.position.lerp(targetVec, 0.35);
          }
        }
      });

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

      {/* Floating Perception Active Banner */}
      {scanEvent?.active && (
        <div className="viewport-perception-banner">
          <Scan size={16} className="spin-icon" />
          <span>
            [RGB-D Vision Scan] Searching for <strong>{friendlyName(scanEvent.targetObject)}</strong> across tabletop...
          </span>
        </div>
      )}

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

      {/* Robot Holographic Speech Refusal Bubble */}
      {armSpeech && (
        <div className={`viewport-speech-bubble ${armSpeech.type}`}>
          <div className="speech-avatar-badge">
            <span className="speech-emoji">🤖</span>
            <div className="speech-soundwave">
              <span className="soundwave-bar bar-1" />
              <span className="soundwave-bar bar-2" />
              <span className="soundwave-bar bar-3" />
            </div>
          </div>
          <div className="speech-body">
            <div className="speech-tag-row">
              <span className="speech-tag">NORA INTERLOCK</span>
              <span className="speech-tag-detail">Manipulation Only</span>
            </div>
            <div className="speech-message">{armSpeech.message}</div>
            {armSpeech.subtext && <div className="speech-subtext">{armSpeech.subtext}</div>}
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
        const isReachable = distFromBase <= 0.64;
        return (
          <div className={`viewport-drag-tooltip ${isReachable ? 'reachable' : 'unreachable'}`}>
            <Move size={13} />
            <span>
              {friendlyName(draggingItem)}: X: {dragCoords.x.toFixed(2)}m, Z: {dragCoords.z.toFixed(2)}m (dist: {distFromBase.toFixed(2)}m)
            </span>
            <span className={`drag-reach-badge ${isReachable ? 'badge-ok' : 'badge-warn'}`}>
              {isReachable ? 'Reachable' : '⚠️ Out of reach (>0.64m)'}
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
