// Ensure dragonBones is loaded
if (!window.dragonBones) {
	throw new Error("DragonBones library not found. Please load dragonBones.js first.");
}

// Patch BaseObject.toString ---
(function fixDragonBonesToString() {
	for (let key in dragonBones) {
		const cls = dragonBones[key];
		if (typeof cls === "function" && cls.toString) {
			try { cls.toString(); } catch (e) { cls.toString = Function.prototype.toString; }
		}
	}
})();

/**
 * 1. DragonBonesRenderer
 */
class DragonBonesRenderer {
	constructor(canvas) {
		// 1. Enable MSAA (antialias: true)
		// 2. Enable Premultiplied Alpha
		this.gl = canvas.getContext("webgl", {
			alpha: true,
			antialias: true,
			premultipliedAlpha: true
		});

		this.width = canvas.width;
		this.height = canvas.height;

		this.MAX_VERTICES = 8000;
		this.MAX_INDICES = 24000;
		this.VERTEX_SIZE = 8;
		this.BYTES_PER_VERTEX = this.VERTEX_SIZE * 4;

		this._initShaders();

		this.vertices = new Float32Array(this.MAX_VERTICES * this.VERTEX_SIZE);
		this.indices = new Uint16Array(this.MAX_INDICES);

		this._initBuffers();

		this.vertexCount = 0;
		this.indexCount = 0;
		this.currentTexture = null;
	}

	createTexture(image) {
		const gl = this.gl;
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);

		// 1. Pre-multiply alpha (Works with gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA))
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

		// Check if Power of Two
		function isPowerOf2(value) {
			return (value & (value - 1)) === 0;
		}

		if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
			// 2. Generate Mipmaps (Best quality for scaling down)
			gl.generateMipmap(gl.TEXTURE_2D);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		} else {
			// Fallback for Non-Power-of-Two (No mipmaps, might shimmer when scaled down)
			// console.warn("Texture is not Power-of-Two. Mipmaps disabled.");
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		}

		// Attach image for dimensions (Required for Factory)
		tex.image = image;

		return tex;
	}

	_initShaders() {
		const vs = `
            attribute vec2 aP; attribute vec2 aUV; attribute vec4 aC;
            uniform mat4 uP; varying vec2 vUV; varying vec4 vC;
            void main() { gl_Position = uP * vec4(aP, 0.0, 1.0); vUV = aUV; vC = aC; }
        `;
		const fs = `
            precision mediump float; varying vec2 vUV; varying vec4 vC;
            uniform sampler2D uT;
            void main() { gl_FragColor = texture2D(uT, vUV) * vC; }
        `;

		const p = this.gl.createProgram();
		const s = (t, src) => {
			const sh = this.gl.createShader(t);
			this.gl.shaderSource(sh, src);
			this.gl.compileShader(sh);
			this.gl.attachShader(p, sh);
		};
		s(this.gl.VERTEX_SHADER, vs);
		s(this.gl.FRAGMENT_SHADER, fs);
		this.gl.linkProgram(p);
		this.gl.useProgram(p);

		this.att = {
			aP: this.gl.getAttribLocation(p, "aP"),
			aUV: this.gl.getAttribLocation(p, "aUV"),
			aC: this.gl.getAttribLocation(p, "aC")
		};

		this.gl.enable(this.gl.BLEND);

		// Use ONE / ONE_MINUS_SRC_ALPHA for Premultiplied Alpha
		// This is crucial for clean edges when textures are scaled or interpolated.
		this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);

		const proj = new Float32Array([2 / this.width, 0, 0, 0, 0, -2 / this.height, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]);
		this.gl.uniformMatrix4fv(this.gl.getUniformLocation(p, "uP"), false, proj);
		this.gl.uniform1i(this.gl.getUniformLocation(p, "uT"), 0);
	}

	_initBuffers() {
		this.vertexBuffer = this.gl.createBuffer();
		this.indexBuffer = this.gl.createBuffer();

		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, this.vertices.byteLength, this.gl.DYNAMIC_DRAW);

		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, this.indices.byteLength, this.gl.DYNAMIC_DRAW);
	}

	begin() {
		this.vertexCount = 0;
		this.indexCount = 0;
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}

	flush() {
		if (this.vertexCount === 0) return;

		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
		this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.vertices.subarray(0, this.vertexCount * this.VERTEX_SIZE));

		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
		this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, this.indices.subarray(0, this.indexCount));

		const b = this.BYTES_PER_VERTEX;
		this.gl.enableVertexAttribArray(this.att.aP);
		this.gl.vertexAttribPointer(this.att.aP, 2, this.gl.FLOAT, false, b, 0);

		this.gl.enableVertexAttribArray(this.att.aUV);
		this.gl.vertexAttribPointer(this.att.aUV, 2, this.gl.FLOAT, false, b, 8);

		this.gl.enableVertexAttribArray(this.att.aC);
		this.gl.vertexAttribPointer(this.att.aC, 4, this.gl.FLOAT, false, b, 16);

		this.gl.bindTexture(this.gl.TEXTURE_2D, this.currentTexture);
		this.gl.drawElements(this.gl.TRIANGLES, this.indexCount, this.gl.UNSIGNED_SHORT, 0);

		this.vertexCount = 0;
		this.indexCount = 0;
	}

	renderMesh(texture, vertices, uvs, indices, color) {
		const numVerts = vertices.length / 2;
		const numIndices = indices.length;

		if (this.currentTexture !== texture ||
			this.vertexCount + numVerts > this.MAX_VERTICES ||
			this.indexCount + numIndices > this.MAX_INDICES) {
			this.flush();
			this.currentTexture = texture;
		}

		let vOffset = this.vertexCount * this.VERTEX_SIZE;
		const vBuf = this.vertices;

		for (let i = 0; i < numVerts; i++) {
			vBuf[vOffset++] = vertices[i * 2];
			vBuf[vOffset++] = vertices[i * 2 + 1];
			vBuf[vOffset++] = uvs[i * 2];
			vBuf[vOffset++] = uvs[i * 2 + 1];
			vBuf[vOffset++] = color[0];
			vBuf[vOffset++] = color[1];
			vBuf[vOffset++] = color[2];
			vBuf[vOffset++] = color[3];
		}

		let iOffset = this.indexCount;
		const iBuf = this.indices;
		const baseIndex = this.vertexCount;

		for (let i = 0; i < numIndices; i++) {
			iBuf[iOffset++] = baseIndex + indices[i];
		}

		this.vertexCount += numVerts;
		this.indexCount += numIndices;
	}
}

class WebGLTextureAtlasData extends dragonBones.TextureAtlasData {
	constructor() { super(); this.renderTexture = null; }
	_onClear() { super._onClear(); this.renderTexture = null; }
	createTexture() { return dragonBones.BaseObject.borrowObject(dragonBones.TextureData); }
}
WebGLTextureAtlasData.toString = Function.prototype.toString;

/**
 * 2. WebGL Slot
 */
class WebGLSlot extends dragonBones.Slot {
	constructor() {
		super();
		this._renderDisplay = null;
		this._color = new Float32Array([1, 1, 1, 1]);

		this._indices = null;
		this._uvs = null;
		this._localVertices = null;
		this._resultVertices = null;
	}

	_onClear() {
		super._onClear();
		this._renderDisplay = null;
		this._indices = null;
		this._uvs = null;
		this._localVertices = null;
		this._resultVertices = null;
	}

	_initDisplay() { }
	_disposeDisplay() { }
	_onUpdateDisplay() {
		this._renderDisplay = this._display || this._rawDisplay;
	}
	_addDisplay() { }
	_replaceDisplay(value) {
		this._renderDisplay = value;
	}
	_updateVisible() { }
	_updateBlendMode() { }
	_updateTransform() { }

	_updateColor() {
		const c = this._colorTransform;
		this._color[0] = c.redMultiplier;
		this._color[1] = c.greenMultiplier;
		this._color[2] = c.blueMultiplier;
		this._color[3] = c.alphaMultiplier;
	}

	_updateFrame() {
		const frame = this._displayFrame;
		const textureData = frame.getTextureData();
		if (!textureData) return;

		const displayData = frame.displayData || frame.rawDisplayData;
		const isMesh = (displayData && displayData.type === 2);

		// -- Indices --
		if (isMesh) {
			const geom = displayData.geometry;
			const intArray = geom.data.intArray;
			const indexOffset = geom.offset + 4;
			const indexCount = intArray[geom.offset + 1] * 3;

			if (!this._indices || this._indices.length !== indexCount) {
				this._indices = new Uint16Array(indexCount);
			}
			for (let i = 0; i < indexCount; i++) {
				this._indices[i] = intArray[indexOffset + i];
			}
		} else {
			if (!this._indices || this._indices.length !== 6) {
				this._indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
			}
		}

		// -- Vertices & UVs --
		let vertexCount = 0;
		const region = textureData.region;

		// Ensure we have valid atlas dimensions
		const w = textureData.parent.width || 1;
		const h = textureData.parent.height || 1;

		if (isMesh) {
			const geom = displayData.geometry;
			vertexCount = geom.data.intArray[geom.offset + 0];
			const floatArray = geom.data.floatArray;
			const uvOffset = geom.data.intArray[geom.offset + 2] + vertexCount * 2;

			if (!this._uvs || this._uvs.length !== vertexCount * 2) {
				this._uvs = new Float32Array(vertexCount * 2);
				this._localVertices = new Float32Array(vertexCount * 2);
				this._resultVertices = new Float32Array(vertexCount * 2);
			}

			for (let i = 0; i < vertexCount; i++) {
				let u = floatArray[uvOffset + i * 2];
				let v = floatArray[uvOffset + i * 2 + 1];

				if (textureData.rotated) {
					this._uvs[i * 2] = (region.x + (1.0 - v) * region.width) / w;
					this._uvs[i * 2 + 1] = (region.y + u * region.height) / h;
				} else {
					this._uvs[i * 2] = (region.x + u * region.width) / w;
					this._uvs[i * 2 + 1] = (region.y + v * region.height) / h;
				}
			}
		} else {
			vertexCount = 4;
			if (!this._uvs || this._uvs.length !== 8) {
				this._uvs = new Float32Array(8);
				this._localVertices = new Float32Array(8);
				this._resultVertices = new Float32Array(8);
			}

			let l, r, t, b;
			if (textureData.rotated) {
				l = region.x / w; t = region.y / h;
				r = (region.x + region.height) / w; b = (region.y + region.width) / h;
				this._uvs.set([r, t, r, b, l, b, l, t]);
			} else {
				l = region.x / w; t = region.y / h;
				r = (region.x + region.width) / w; b = (region.y + region.height) / h;
				this._uvs.set([l, t, r, t, r, b, l, b]);
			}

			let pX = 0, pY = 0;
			if (displayData && displayData.type === 0) {
				pX = displayData.pivot.x; pY = displayData.pivot.y;
			}
			const rect = textureData.frame || textureData.region;
			let rw = rect.width, rh = rect.height;
			if (textureData.rotated && !textureData.frame) { rw = rect.height; rh = rect.width; }

			pX *= rw; pY *= rh;
			if (textureData.frame) { pX += textureData.frame.x; pY += textureData.frame.y; }

			this._localVertices.set([
				-pX, -pY,
				rw - pX, -pY,
				rw - pX, rh - pY,
				-pX, rh - pY
			]);
		}
	}

	_updateMesh() {
		const frame = this._displayFrame;
		if (!frame) return;
		const displayData = frame.displayData || frame.rawDisplayData;
		if (!displayData || displayData.type !== 2) return;

		const geom = displayData.geometry;
		const weight = geom.weight;
		const hasWeight = !!weight;

		const rawVertices = geom.data.floatArray;
		const verticesOffset = geom.data.intArray[geom.offset + 2];

		const deformVertices = frame.deformVertices;
		const hasDeform = deformVertices && deformVertices.length > 0;
		const result = this._localVertices;

		if (hasWeight) {
			// --- SKINNING ---
			const boneIndices = geom.data.intArray;
			let iB = weight.offset + 2 + weight.bones.length;
			let weightFloatIndex = geom.data.intArray[weight.offset + 1];

			const numVerts = result.length / 2;

			for (let i = 0; i < numVerts; i++) {
				const boneCount = boneIndices[iB++];
				let xG = 0, yG = 0;

				for (let j = 0; j < boneCount; j++) {
					const boneIndex = boneIndices[iB++];
					const bone = this._geometryBones[boneIndex];

					if (bone) {
						const m = bone.globalTransformMatrix;
						const w = rawVertices[weightFloatIndex];
						const vx = rawVertices[weightFloatIndex + 1];
						const vy = rawVertices[weightFloatIndex + 2];

						xG += (m.a * vx + m.c * vy + m.tx) * w;
						yG += (m.b * vx + m.d * vy + m.ty) * w;
					}

					weightFloatIndex += 3;
				}
				result[i * 2] = xG;
				result[i * 2 + 1] = yG;
			}
		} else {
			// --- MESH NO WEIGHTS ---
			const numVerts = result.length / 2;
			for (let i = 0; i < numVerts; i++) {
				let x = rawVertices[verticesOffset + i * 2];
				let y = rawVertices[verticesOffset + i * 2 + 1];
				if (hasDeform) {
					x += deformVertices[i * 2];
					y += deformVertices[i * 2 + 1];
				}
				result[i * 2] = x;
				result[i * 2 + 1] = y;
			}
		}
	}

	render(renderer, display) {
		if (!this._renderDisplay || this._displayIndex < 0 || !this._visible || this._color[3] <= 0) return;
		if (!this._localVertices) return;

		const displayData = this._displayFrame.displayData || this._displayFrame.rawDisplayData;
		const isMesh = (displayData && displayData.type === 2);
		const hasWeight = isMesh && displayData.geometry.weight;

		const local = this._localVertices;
		const result = this._resultVertices;
		const count = local.length / 2;

		// Read transform from the display object
		const x = display.x;
		const y = display.y;
		const sx = display.scaleX;
		const sy = display.scaleY;

		if (hasWeight) {
			// Weighted meshes are calculated in Armature Space in _updateMesh
			// We just apply Scale and Translation
			for (let i = 0; i < count; i++) {
				result[i * 2] = local[i * 2] * sx + x;
				result[i * 2 + 1] = local[i * 2 + 1] * sy + y;
			}
		} else {
			// Images/Static Meshes use the globalTransformMatrix (Armature Space)
			// We apply the Matrix, then Scale the result, then Translate
			const m = this.globalTransformMatrix;
			for (let i = 0; i < count; i++) {
				let lx = local[i * 2];
				let ly = local[i * 2 + 1];

				// Transform from Slot Space to Armature Space
				let rawX = m.a * lx + m.c * ly + m.tx;
				let rawY = m.b * lx + m.d * ly + m.ty;

				// Apply Display Object Transform
				result[i * 2] = rawX * sx + x;
				result[i * 2 + 1] = rawY * sy + y;
			}
		}

		const textureAtlasData = this._displayFrame.getTextureData().parent;
		renderer.renderMesh(textureAtlasData.renderTexture, result, this._uvs, this._indices, this._color);
	}
}
WebGLSlot.toString = Function.prototype.toString;

// --- Visual Container ---
class WebGLArmatureDisplay {
	constructor() {
		this._armature = null;
		this._events = {};
		this.x = 0;
		this.y = 0;
		this.scaleX = 1.0;
		this.scaleY = 1.0;
	}

	// Helper to set both at once
	set scale(value) {
		this.scaleX = value;
		this.scaleY = value;
	}
	get scale() {
		return this.scaleX;
	}

	dbInit(armature) {
		this._armature = armature;
	}
	dbClear() {
		this._armature = null; this._events = {};
	}
	dbUpdate() { }
	dispose() {
		if (!this._armature) return;
		this._armature.dispose();
		this._armature = null;
	}

	hasDBEventListener(type) {
		return !!this._events[type];
	}
	addDBEventListener(type, listener, target) {
		if (!this._events[type]) this._events[type] = [];
		this._events[type].push({ listener, target });
	}
	removeDBEventListener(type, listener) {
		if (!this._events[type]) return;
		this._events[type] = this._events[type].filter(e => e.listener !== listener);
	}
	dispatchDBEvent(type, eventObject) {
		if (this._events[type]) this._events[type].forEach(e => e.listener.call(e.target, eventObject));
	}

	get armature() {
		return this._armature;
	}
	get animation() {
		return this._armature.animation;
	}

	advanceTime(dt) {
		if (this._armature) {
			this._armature.advanceTime(dt);
		}
	}

	render(renderer) {
		if (!this._armature) return;

		const slots = this._armature.getSlots();
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i];
			if (slot instanceof WebGLSlot) {
				// Pass 'this' so the slot can access x, y, scaleX, scaleY
				slot.render(renderer, this);
			}
		}
	}
}

// --- Factory ---
class WebGLFactory extends dragonBones.BaseFactory {
	constructor(renderer) {
		super();
		this.renderer = renderer;
		this._dragonBones = new dragonBones.DragonBones(this);
	}
	_buildTextureAtlasData(textureAtlasData, textureAtlas) {
		if (textureAtlasData) {
			textureAtlasData.renderTexture = textureAtlas;

			// Auto-fill dimensions from the HTML Image ---
			// The logic below expects the passed textureAtlas to be the WebGLTexture 
			// WITH the original Image attached to it as a property (see index.html)
			if (textureAtlas && textureAtlas.image) {
				if (textureAtlasData.width === 0) textureAtlasData.width = textureAtlas.image.width;
				if (textureAtlasData.height === 0) textureAtlasData.height = textureAtlas.image.height;
			}
		} else {
			textureAtlasData = dragonBones.BaseObject.borrowObject(WebGLTextureAtlasData);
		}
		return textureAtlasData;
	}
	_buildArmature(dataPackage) {
		const armature = dragonBones.BaseObject.borrowObject(dragonBones.Armature);
		const armatureDisplay = new WebGLArmatureDisplay();
		armature.init(dataPackage.armature, armatureDisplay, armatureDisplay, this._dragonBones);
		return armature;
	}
	_buildSlot(dataPackage, slotData, armature) {
		const slot = dragonBones.BaseObject.borrowObject(WebGLSlot);
		slot.init(slotData, armature, {}, {});
		return slot;
	}
}

async function loadArmature(factory, config) {
	const {
		directoryPath,
		skeletonFile,
		textureAtlasFile,
		textureImageFile,
		defaultArmatureName,
		defaultAnimationName
	} = config;

	const skeletonData = await fetch(`${directoryPath}/${skeletonFile}`);
	const ske = skeletonFile.endsWith(".dbbin")
		? await skeletonData.arrayBuffer()
		: await skeletonData.json();

	const tex = await (await fetch(`${directoryPath}/${textureAtlasFile}`)).json();

	const img = await new Promise((resolve, reject) => {
		const i = new Image();
		i.onload = () => resolve(i);
		i.onerror = (e) => reject(e);
		i.src = `${directoryPath}/${textureImageFile}`;
	});

	// Use the renderer from the factory to create texture
	const texture = factory.renderer.createTexture(img);

	factory.parseDragonBonesData(ske);
	factory.parseTextureAtlasData(tex, texture);

	const armature = factory.buildArmature(defaultArmatureName);
	if (defaultAnimationName) {
		armature.animation.play(defaultAnimationName);
	}

	// Automatically add to clock if available
	if (factory.clock) {
		factory.clock.add(armature);
	}

	return armature;
}

window.DragonBonesWebGL = { Renderer: DragonBonesRenderer, Factory: WebGLFactory, loadArmature };