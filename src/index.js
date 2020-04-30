const THREE = require('three');
const OrbitControls = require('three-orbit-controls')(THREE);
const OBJLoader = require('three-obj-loader')(THREE);
const MTLLoader = require('three-mtl-loader');
import getJSON from './json';

// Initialize scene and renderer
let scene = new THREE.Scene();
let renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

class PrintedGroup {
    constructor(printedMeshes) {
        this.group = new THREE.Group();
        this.showing = false;

        if (printedMeshes) {
            for (let printedMesh of printedMeshes) {
                this.group.add(printedMesh);
            }
        }
    }

    /**
     * 
     * @param {THREE.Mesh} printed 
     */
    add(printed) {
        this.group.add(printed);
    }

    addToScene() {
        if (this.showing === true) {
            return;
        }

        this.showing = true;
        scene.add(this.group);
    }

    removeFromScene() {
        if (this.showing === false) {
            return;
        }

        this.showing = false;
        scene.remove(this.group);
    }
}

class Keyframe {
    constructor(x, y, z, rotation) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.rotation = rotation;
    }
}

class Robot {
    constructor(threeJsObjectGroup) {
        this.objectGroup = threeJsObjectGroup;
        this.body = this.objectGroup.children[1];
        this.printhead = this.objectGroup.children[0];

        this.body.scale.set(4, 4, 4);
        this.printhead.scale.set(4, 4, 4);

        this.keyframes = [];
    }

    setLocation(x, y, z) {
        this.body.position.set(x, 0, z);
        this.printhead.position.set(x, y, z);
    }

    setRotation(theta) {
        this.body.rotation.set(0, theta, 0);
        this.printhead.rotation.set(0, theta, 0);
    }

    addKeyframe(x, y, z, rotation) {
        this.keyframes.push(new Keyframe(x, y, z, rotation));
    }

    setFrame(frameIndex) {
        if (frameIndex >= this.keyframes.length) {
            return;
        } else {
            let keyframe = this.keyframes[frameIndex];
            this.setLocation(keyframe.x, keyframe.y, keyframe.z);
            this.setRotation(keyframe.rotation);
        }
    }

    addToScene() {
        scene.add(this.objectGroup);
    }

    removeFromScene() {
        scene.remove(this.objectGroup);
    }

    /**
     * Clones this Robot. Only copies the graphics objects, not keyframes
     */
    clone() {
        let newObjectGroup = this.objectGroup.clone();
        let newRobot = new Robot(newObjectGroup);
        return newRobot;
    }
}

class ColorInterpolator {
    constructor() {
        this.minValue = 0;
        this.maxValue = 1;
        this.rStart = 0;
        this.rEnd = 255;
        this.gStart = 0;
        this.gEnd = 255;
        this.bStart = 0;
        this.bEnd = 255;
    }

    setColorRange(colorStart, colorEnd) {
        this.rStart = (colorStart & 0xff0000) >> 16;
        this.gStart = (colorStart & 0x00ff00) >> 8;
        this.bStart = (colorStart & 0x0000ff);

        this.rEnd = (colorEnd & 0xff0000) >> 16;
        this.gEnd = (colorEnd & 0x00ff00) >> 8;
        this.bEnd = (colorEnd & 0x0000ff);
    }

    setValueRange(minValue, maxValue) {
        this.minValue = minValue;
        this.maxValue = maxValue;
    }

    interpolate(value, start, end) {
        let percentage = (value - this.minValue) / (this.maxValue - this.minValue);
        return Math.floor(percentage * (end - start) + start);
    }

    getColor(value) {
        let rValue = this.interpolate(value, this.rStart, this.rEnd);
        let gValue = this.interpolate(value, this.gStart, this.gEnd);
        let bValue = this.interpolate(value, this.bStart, this.bEnd);

        return (rValue << 16) + (gValue << 8) + bValue;
    }
}

class Simulation {
    constructor() {
        this.frameCount = 0;
        this.currentFrame = 0;
        this.printedGroups = [];
        this.robots = [];
        this.lastPrintedFrame = 0;
        this.modelHeight = 0;
    }

    downloadSimulationFile(url, downloadCallback) {
        getJSON(url, (_, response) => {
            downloadCallback(response);
        });
    }

    initalizeRobots(robotInitializations) {
        let robotCount = robotInitializations.length;

        // If we have more than 1 robot, remove the other robots
        if (this.robots.length > 1) {
            for (let i = 1; i < this.robots.length; i++) {
                this.robots[i].removeFromScene();
            }

            this.robots = [this.robots[0]];
        }

        // If we have just one robot, create enough clones to properly simulate
        if (this.robots.length === 1) {
            const baseRobot = this.robots[0];
            for (let i = 1; i < robotCount; i++) {
                let newRobot = baseRobot.clone();
                newRobot.addToScene();
                this.robots.push(newRobot);
            }
        } else {
            return 1;
        }

        // Set the first keyframe for each robot
        for (let robotInitialization of robotInitializations) {
            let robotIndex = robotInitialization.n;
            if (robotIndex >= this.robots.length) {
                return 1;
            }

            let robot = this.robots[robotIndex];

            robot.addKeyframe(robotInitialization.v[0] / -10, robotInitialization.v[2] / 10, robotInitialization.v[1] / 10, robotInitialization.r);
        }

        // Completed initialization successfully, return true
        return 0;
    }

    setRobotKeyframes(simulationFrames) {
        for (let simulationFrame of simulationFrames) {
            let simulationRobots = simulationFrame.machines;

            for (let simulationRobot of simulationRobots) {
                let robotIndex = simulationRobot.n;
                if (robotIndex >= this.robots.length) {
                    return 1;
                }

                let robot = this.robots[robotIndex];
                robot.addKeyframe(simulationRobot.v[0] / -10, simulationRobot.v[2] / 10, simulationRobot.v[1] / 10, simulationRobot.r);

                if (simulationRobot.v[2] / 10 > this.modelHeight) {
                    this.modelHeight = simulationRobot.v[2] / 10;
                }
            }
        }

        return 0;
    }

    createdPrintedGroups(simulationFrames) {
        let colorInterpolator = new ColorInterpolator();
        colorInterpolator.setColorRange(0x2d3dbf, 0xffffff);
        colorInterpolator.setValueRange(0, this.modelHeight * 1.1);

        this.printedGroups.push(new PrintedGroup());

        for (let simulationFrame of simulationFrames) {
            let simulationPrinteds = simulationFrame.printeds;

            let printedGroup = new PrintedGroup();
            for (let simulationPrinted of simulationPrinteds) {
                if (simulationPrinted.length < 2) {
                    continue;
                }

                let geometry = new THREE.Geometry();
                let height = 0;
                for (let vertex of simulationPrinted) {
                    height = vertex[2] / 10;
                    let newVertex = new THREE.Vector3(vertex[0] / -10, vertex[2] / 10, vertex[1] / 10);
                    geometry.vertices.push(newVertex);
                }

                let lineMaterial = new THREE.LineBasicMaterial({
                    color: colorInterpolator.getColor(height)
                });

                let tube = new THREE.Line(geometry, lineMaterial);
                printedGroup.add(tube);
            }

            this.printedGroups.push(printedGroup);
        }

        return 0;
    }

    loadSimulation(url, completionCallback) {
        this.downloadSimulationFile(url, (simulation) => {
            if (!simulation) {
                completionCallback(false);
                return;
            }

            if (!simulation.init || !simulation.init.machines || !simulation.frames) {
                completionCallback(false);
                return;
            }

            this.frameCount = simulation.frames.length;

            const initializationError = this.initalizeRobots(simulation.init.machines);
            if (initializationError !== 0) {
                completionCallback(false);
                return;
            }

            const robotKeyframeError = this.setRobotKeyframes(simulation.frames);
            if (robotKeyframeError !== 0) {
                completionCallback(false);
                return;
            }

            const printedGroupsError = this.createdPrintedGroups(simulation.frames);
            if (printedGroupsError !== 0) {
                completionCallback(false);
                return;
            }

            completionCallback(true);
        });
    }

    previousFrame() {
        this.currentFrame -= 1;
        this.drawFrame();
    }

    nextFrame() {
        this.currentFrame += 1;
        this.drawFrame();
    }

    drawFrame() {
        if (this.currentFrame < 0 || this.currentFrame >= this.frameCount) {
            this.currentFrame = (this.currentFrame + this.frameCount) % this.frameCount;
        }

        for (let robot of this.robots) {
            robot.setFrame(this.currentFrame);
        }

        if (this.lastPrintedFrame < this.currentFrame) {
            for (let i = this.lastPrintedFrame; i <= this.currentFrame; i++) {
                this.printedGroups[i].addToScene();
            }
        } else if (this.lastPrintedFrame > this.currentFrame) {
            for (let i = this.currentFrame + 1; i <= this.lastPrintedFrame; i++) {
                this.printedGroups[i].removeFromScene();
            }
        }

        this.updateFrameCounter();

        this.lastPrintedFrame = this.currentFrame;
    }

    updateFrameCounter() {
        document.getElementById('frameCounter').innerHTML = this.currentFrame + ' | ' + this.frameCount;
    }

    setFrame(frame) {
        this.currentFrame = frame;
        this.drawFrame();
    }

    setBaseRobot(robot) {
        for (let currentRobot of this.robots) {
            currentRobot.removeFromScene();
        }

        this.robots = [];
        this.robots.push(robot);
        robot.addToScene();
    }

    isFinished() {
        return this.currentFrame + 1 === this.frameCount;
    }
}

let isSimulationRunning = false;
let simulation = new Simulation();
let simulationFileName = 'simulation.json';
let isLoading = false;
const SIMULATION_FPS = 30;

function updateInfoText(text, error) {
    if (document.getElementById('infoText')) {
        document.getElementById('infoText').innerHTML = text;

        if (error) {
            document.getElementById('infoText').color = '#ff0000';
        }
    }
}

function updatePlayButton() {
    document.getElementById('playButton').innerHTML = isSimulationRunning ? 'Stop Simulation' : 'Play Simulation';
    document.getElementById('playButton').style.background = isSimulationRunning ? '#ff0000' : '#1a913e';
}

function stopSimulation() {
    isSimulationRunning = false;
    updatePlayButton();
}

function onPlayClicked() {
    updateInfoText('');
    isSimulationRunning = !isSimulationRunning;
    updatePlayButton();
}

function onPreviousClicked() {
    if (isSimulationRunning) {
        return;
    } else {
        simulation.previousFrame();
    }
}

function onNextClicked() {
    if (isSimulationRunning) {
        return;
    } else {
        simulation.nextFrame();
    }
}

function documentLoaded() {
    document.getElementById('previousButton').onclick = onPreviousClicked;
    document.getElementById('playButton').onclick = onPlayClicked;
    document.getElementById('nextButton').onclick = onNextClicked;

    updateInfoText('Loading Simulation File: ' + simulationFileName);
    simulation.loadSimulation('./simulations/' + simulationFileName, completed => {
        if (!completed) {
            updateInfoText('Could not load simulation JSON file.', true);
        } else {
            updateInfoText('Finished loading. Click `Play Simulation`');
            simulation.setFrame(0);
            simulation.updateFrameCounter();
        }
    })
}

// Initialize camera and camera controls (via mouse)
let camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
let controls = new OrbitControls(camera);

// Set default camera position
camera.position.set(0, 20, 50);
controls.update();

// Add grid visual
let grid = new THREE.GridHelper(50, 50, 0x555555, 0x555555);
grid.position.set(0, 0, 0);
scene.add(grid);

// Add an ambient light
let ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);

// Add an overhead point-light
let pointLight = new THREE.PointLight(0xffffff, 2, 100);
pointLight.position.set(0, 50, 0);
scene.add(pointLight);

// Load robot OBJ
let objLoader = new THREE.OBJLoader();
let materialLoader = new MTLLoader();

isLoading = true;
updateInfoText('Loading OBJ files...');
materialLoader.load(
    './models/am3-bot-v2.mtl',
    materials => {
        materials.preload();

        objLoader.setMaterials(materials);
        objLoader.load(
            './models/am3-bot-v2.obj',
            object => {
                console.log(object);
                simulation.setBaseRobot(new Robot(object));
                isLoading = false;

                documentLoaded();
            }
        );
    }
);

const frameMillis = 1000.0 / SIMULATION_FPS;
let lastTime = (new Date()).getTime();

function animate() {
    requestAnimationFrame(animate);

    let currentTime = (new Date()).getTime();

    if (isLoading) {
        renderer.render(scene, camera);
        return;
    }

    // Main render loop after loading complete
    if (isSimulationRunning) {
        if (currentTime - lastTime > frameMillis) {
            simulation.nextFrame();
            lastTime = currentTime;

            if (simulation.isFinished()) {
                stopSimulation();
            }
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

animate();
