import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.167.1/build/three.module.js';

export class Gradient2D{
    #width;
    #height;
    #antialias;
    #async;
    #camera;
    #scene;
    #geometry;
    #material;
    #mesh;
    #renderer;
    #context;
    #allowAnimate = true;
    #parent;
    #pickingTexture;
    #vertexShader = `
        varying vec2 vUv;
        void main()	{
            vUv = uv;
            gl_Position = vec4( position, 1.0 );
        }
    `;
    #fragmentShader = `
        #define RECORDSIZE 2
        #define MAXPOINTS 10
        varying vec2 vUv;
        uniform vec3 f[ MAXPOINTS * RECORDSIZE ];

        vec3 calculateColor(vec2 uv) {
            vec3 outColor = vec3(0.0);
            float total = 0.0;

            for (int i = 0; i < MAXPOINTS; ++i) {
                int pi = i * RECORDSIZE;
                float weight = f[pi].z;
                if (weight < 0.0) continue;
                vec2 position = f[pi].xy;
                vec3 color = f[pi + 1];

                float d = smoothstep(0.0, weight/2.0, distance(position, uv));
                if (d == 0.0) {
                    return color;
                }
                d = weight / (d * d);
                outColor += d * color;
                total += d;
            }

            return outColor / total;
        }

        void main()	{
            vec3 col = calculateColor(vUv);
            gl_FragColor = vec4(col, 1.0);
        }
    `;
    #colorStops = [];

    constructor(width=256, height=256, parent = null, async = true, antialias = true){
        this.#parent = parent;
        this.#width = width;
        this.#height = height;
        this.#async = async;
        this.#antialias = antialias;
        this.#init();
    }

    #createMaterial(numStops){
        let fragShader = this.#fragmentShader;
        fragShader = fragShader.replace('#define MAXPOINTS 10','#define MAXPOINTS ' + Math.max(1, numStops));
        let material = new THREE.ShaderMaterial( {
            uniforms: {
                f: {
                    value: this.#colorStops
                }
            },
            vertexShader: this.#vertexShader,
            fragmentShader: fragShader
        } );                
        return material;
    }

    #createRenderer(parent, width, height, antialias = true){
        let renderer = new THREE.WebGLRenderer( { antialias: antialias, preserveDrawingBuffer: true } );
        renderer.setSize( width , height);
        parent.appendChild( renderer.domElement );   
        return renderer;
    }

    #unload(){
        if (this.#renderer != null) { this.#renderer.dispose();}
        this.#renderer = null;
        this.#mesh = null;
        if (this.#geometry != null) { this.#geometry.dispose();}
        this.#geometry = null;
        if (this.#material != null) { this.#material.dispose();}
        this.#material = null;
        this.#scene = null;
        this.#camera = null;
    }

    #animate() {
        if (!this.#allowAnimate || this.#renderer == null || this.#scene == null || this.#camera == null) return;
        this.render();
        requestAnimationFrame( ()=>{this.#animate(); });
    }

    #init(){
        this.#camera = new THREE.PerspectiveCamera( 40, 1 / 1, 0.02, 10 );
        this.#camera.position.z = 0.5;
        this.#scene = new THREE.Scene();
        this.#geometry = new THREE.PlaneGeometry( 2.0, 2.0 );
        if (this.#material != null){ this.#material.dispose();}
        this.#material = this.#createMaterial(this.#colorStops.length / 2);
        this.#mesh = new THREE.Mesh( this.#geometry, this.#material );
        this.#scene.add(this.#mesh );
        if (this.#parent == null){
            this.#parent = document.createElement('div');
        }
        if (this.#async){
            this.#pickingTexture = new THREE.WebGLRenderTarget( this.#width, this.#height, {
                type: THREE.UnsignedByteType,
                format: THREE.RGBAFormat,
            } );
        }
        this.#renderer = this.#createRenderer(this.#parent, this.#width, this.#height, this.#antialias);
        this.#context = this.#renderer.domElement.getContext('webgl2');
    }

    #resetMaterial(){
        if (this.#material != null) { this.#material.dispose();}
        this.#material = null;
        this.#material = this.#createMaterial(this.#colorStops.length / 2);
        this.#mesh.material = this.#material;
    }

    render(){
        if (this.#async){
            this.#renderer.setRenderTarget( this.#pickingTexture );
            this.#renderer.render( this.#scene, this.#camera );
            this.#renderer.setRenderTarget( null );
        }
        this.#renderer.render( this.#scene, this.#camera );
    }

    start(){
        this.#allowAnimate = true;
        this.#animate();
    }

    stop(){
        this.#allowAnimate = false;
    }

    addColorStop(x, y, weight, r, g, b){
        this.#colorStops.push(new THREE.Vector3( x, y, weight ));
        if (typeof(r)=='string'){
            let c = new THREE.Color(r);
            //c.convertLinearToSRGB();
            this.#colorStops.push(new THREE.Vector3(c.r, c.g, c.b));
        } else {
            this.#colorStops.push(new THREE.Vector3(r, g, b));
        }
        this.#resetMaterial();
    }

    deleteColorStop(colorStopIndex){
        this.#colorStops.splice(colorStopIndex, 2);
        this.#resetMaterial();
    }

    clear(){
        this.#allowAnimate = false;
        this.#colorStops = [];
        this.#resetMaterial();
    }

    saveImageToFile(fileName = 'Beatline_gradient.png'){
        this.#renderer.render( this.#scene, this.#camera );
        this.#renderer.domElement.toBlob(function(blob){
            let a = document.createElement('a');
            let url = URL.createObjectURL(blob);
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(a.href);
        }, 'image/png', 1.0);
    }

    getColorAsHex(colorStopIndex){
        let c = this.#colorStops[colorStopIndex + 1];
        let col = new THREE.Color(c.x, c.y, c.z);
        return col.getHexString();
    }

    setColorAsHex(colorStopIndex, colorHexString){
        let c = this.#colorStops[colorStopIndex + 1];
        let col = new THREE.Color(colorHexString);
        //col.convertLinearToSRGB();
        c.x = col.r;
        c.y = col.g;
        c.z = col.b;
    }

    getColors(x, y, width = 1, height = 1){
        x = Math.max( 0, Math.floor( x ) );
        y = Math.max( 0, Math.floor( y ) );
        width = Math.max( 1, Math.floor( width ) );
        height = Math.max( 1, Math.floor( height ) );
        
        const pixels = new Uint8Array( width * height * 4 );
        if ( this.#async) {
            return new Promise( ( resolve, reject ) => {
                this.#renderer.readRenderTargetPixelsAsync( this.#pickingTexture, x, y, width, height, pixels )
                .then ( ()=>{ resolve( pixels) ; } )
                .catch( ()=>{ reject()         } );
            } );
        }
        
        //  This is slow.
        this.#context.readPixels(
            x,
            y,
            width,
            height,
            this.#context.RGBA,
            this.#context.UNSIGNED_BYTE,
            pixels
        );
        return Promise.resolve(pixels);
    }

    get colorStops(){
        return this.#colorStops;
    }

    get colorStopCount(){
        return this.#colorStops.length / 2;
    }

    get antialias(){
        return this.#antialias;
    }

    get canvas(){
        return this.#renderer.domElement;
    }
}
