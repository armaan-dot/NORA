import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { rosService } from '../services/rosService';
import type { JointState } from '../types';
import { RotateCcw, Grid, RefreshCw } from 'lucide-react';

export const ThreeCanvas: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const robotRef = useRef<URDFRobot | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const objectMeshesRef = useRef<{
    red_cube?: THREE.Object3D;
    blue_cylinder?: THREE.Object3D;
    green_sphere?: THREE.Object3D;
    water?: THREE.Object3D;
  }>({});

  const objectStatesRef = useRef<Record<string, 'table' | 'held' | 'tray' | 'user'>>({
    red_cube: 'table',
    blue_cylinder: 'table',
    green_sphere: 'table',
    water: 'table'
  });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1117);

    // Subtle fog
    scene.fog = new THREE.FogExp2(0x0e1117, 0.25);

    // 2. Camera setup
    const width = container.clientWidth;
    const height = container.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    camera.position.set(1.4, 1.3, 1.4);
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
    controls.target.set(0, 0.45, 0);
    controls.maxPolarAngle = Math.PI / 2 + 0.05;
    controls.minDistance = 0.4;
    controls.maxDistance = 5.0;
    controlsRef.current = controls;

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
    dirLight.position.set(3, 5, 2.5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const accentLight = new THREE.PointLight(0x00f0ff, 1.5, 4);
    accentLight.position.set(-1.0, 1.0, -1.0);
    scene.add(accentLight);

    // 6. Ground Grid & Floor
    const grid = new THREE.GridHelper(6, 30, 0x00d2ff, 0x1f293d);
    grid.position.y = -0.001;
    scene.add(grid);
    gridHelperRef.current = grid;

    const floorGeo = new THREE.PlaneGeometry(10, 10);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c10,
      roughness: 0.85,
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
      color: 0x242a38,
      roughness: 0.35,
      metalness: 0.4
    });
    const tabletop = new THREE.Mesh(tabletopGeo, tabletopMat);
    tabletop.position.y = tableHeight - tableTopThickness / 2;
    tabletop.receiveShadow = true;
    tabletop.castShadow = true;
    tableGroup.add(tabletop);

    // Edge glowing accent on tabletop
    const edgeGeo = new THREE.BoxGeometry(tableWidth + 0.01, 0.005, tableDepth + 0.01);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
    const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
    edgeMesh.position.y = tableHeight;
    tableGroup.add(edgeMesh);

    // 4 Table Legs
    const legGeo = new THREE.CylinderGeometry(0.025, 0.025, tableHeight - tableTopThickness, 16);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x141720, metalness: 0.7, roughness: 0.3 });
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

    // 8. Tabletop Workspace Objects
    const objectGroup = new THREE.Group();
    const surfaceY = tableHeight;

    // A. Red Cube
    const cubeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const cubeMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.2,
      metalness: 0.1
    });
    const redCube = new THREE.Mesh(cubeGeo, cubeMat);
    redCube.position.set(-0.25, surfaceY + 0.03, 0.22);
    redCube.castShadow = true;
    redCube.receiveShadow = true;
    objectGroup.add(redCube);

    // B. Blue Cylinder
    const cylGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.09, 32);
    const cylMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      roughness: 0.2,
      metalness: 0.6
    });
    const blueCylinder = new THREE.Mesh(cylGeo, cylMat);
    blueCylinder.position.set(0.25, surfaceY + 0.045, 0.2);
    blueCylinder.castShadow = true;
    blueCylinder.receiveShadow = true;
    objectGroup.add(blueCylinder);

    // C. Green Sphere
    const sphereGeo = new THREE.SphereGeometry(0.035, 32, 32);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      roughness: 0.15,
      metalness: 0.3
    });
    const greenSphere = new THREE.Mesh(sphereGeo, sphereMat);
    greenSphere.position.set(-0.28, surfaceY + 0.035, -0.18);
    greenSphere.castShadow = true;
    greenSphere.receiveShadow = true;
    objectGroup.add(greenSphere);

    // D. Water Glass
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

    const waterGeo = new THREE.CylinderGeometry(0.032, 0.026, 0.08, 24);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.85,
      roughness: 0.1
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = -0.01;
    glassGroup.add(waterMesh);

    glassGroup.position.set(0.24, surfaceY + 0.055, -0.18);
    objectGroup.add(glassGroup);

    // E. Storage Tray
    const trayGeo = new THREE.BoxGeometry(0.18, 0.02, 0.18);
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.4 });
    const trayMesh = new THREE.Mesh(trayGeo, trayMat);
    trayMesh.position.set(0.42, surfaceY + 0.01, 0.0);
    trayMesh.receiveShadow = true;
    objectGroup.add(trayMesh);

    scene.add(objectGroup);

    // Save mesh references
    objectMeshesRef.current = {
      red_cube: redCube,
      blue_cylinder: blueCylinder,
      green_sphere: greenSphere,
      water: glassGroup
    };

    const TABLE_POS = {
      red_cube: new THREE.Vector3(-0.25, surfaceY + 0.03, 0.22),
      blue_cylinder: new THREE.Vector3(0.25, surfaceY + 0.045, 0.2),
      green_sphere: new THREE.Vector3(-0.28, surfaceY + 0.035, -0.18),
      water: new THREE.Vector3(0.24, surfaceY + 0.055, -0.18)
    };
    const TRAY_POS = {
      red_cube: new THREE.Vector3(0.38, surfaceY + 0.04, -0.04),
      blue_cylinder: new THREE.Vector3(0.44, surfaceY + 0.055, 0.04),
      green_sphere: new THREE.Vector3(0.45, surfaceY + 0.045, -0.03),
      water: new THREE.Vector3(0.38, surfaceY + 0.065, 0.04)
    };
    const USER_POS = {
      red_cube: new THREE.Vector3(0.0, surfaceY + 0.35, 0.38),
      blue_cylinder: new THREE.Vector3(0.0, surfaceY + 0.35, 0.38),
      green_sphere: new THREE.Vector3(0.0, surfaceY + 0.35, 0.38),
      water: new THREE.Vector3(0.0, surfaceY + 0.35, 0.38)
    };

    // 9. Load NORA URDF
    const loader = new URDFLoader();
    loader.load(
      '/nora_arm.urdf',
      (robot) => {
        robot.position.set(0, surfaceY, 0);
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

    // 10. Subscribe to Joint States via ROS service
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

    // Subscribe to object lifecycle events
    const unsubscribeObjects = rosService.onObjectEvent((event) => {
      objectStatesRef.current[event.name] = event.state;
    });

    // 11. Animation Loop
    let animationFrameId: number;
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
          grip.getWorldPosition(gripPos);
        }
      }

      const meshes = objectMeshesRef.current;
      const states = objectStatesRef.current;
      (Object.keys(meshes) as Array<keyof typeof meshes>).forEach((k) => {
        const mesh = meshes[k];
        if (!mesh) return;
        const st = states[k] || 'table';
        if (st === 'held' && gripPos) {
          mesh.position.lerp(gripPos, 0.35);
        } else if (st === 'tray') {
          mesh.position.lerp(TRAY_POS[k], 0.2);
        } else if (st === 'user') {
          mesh.position.lerp(USER_POS[k], 0.2);
        } else {
          mesh.position.lerp(TABLE_POS[k], 0.2);
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    // 12. Resize handler
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
      cancelAnimationFrame(animationFrameId);
      unsubscribeJoints();
      unsubscribeObjects();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  const resetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(1.4, 1.3, 1.4);
      controlsRef.current.target.set(0, 0.45, 0);
      controlsRef.current.update();
    }
  };

  const toggleGrid = () => {
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = !gridHelperRef.current.visible;
      setShowGrid(gridHelperRef.current.visible);
    }
  };

  return (
    <div className="three-viewport-container">
      <div ref={mountRef} className="three-canvas" />

      {/* Floating Viewport Controls */}
      <div className="viewport-overlay-toolbar">
        <button
          onClick={resetCamera}
          title="Reset Camera View"
          className="viewport-btn"
        >
          <RotateCcw size={15} />
          <span>Reset Cam</span>
        </button>
        <button
          onClick={toggleGrid}
          title="Toggle Ground Grid"
          className={`viewport-btn ${showGrid ? 'active' : ''}`}
        >
          <Grid size={15} />
          <span>Grid</span>
        </button>
        <button
          onClick={() => rosService.resetObjects()}
          title="Reset Tabletop Workspace Items"
          className="viewport-btn"
        >
          <RefreshCw size={14} />
          <span>Reset Items</span>
        </button>
      </div>

      {/* Legend Badge */}
      <div className="viewport-legend">
        <div className="legend-item"><span className="dot red" /> Red Cube</div>
        <div className="legend-item"><span className="dot cyan" /> Water Glass</div>
        <div className="legend-item"><span className="dot blue" /> Blue Cylinder</div>
        <div className="legend-item"><span className="dot green" /> Green Sphere</div>
      </div>

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
