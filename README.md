# DragonBones Standalone WebGL Renderer

This is a **fully standalone** WebGL renderer for DragonBones skeletal animations (in JSON/dbbin format). Apart from the base [DragonBonesJS](https://github.com/DragonBones/DragonBonesJS) runtime, it is completely dependency-free and doesn't require an existing game engine to render the animations. This makes it easy to integrate into any existing engine or framework (such as Phaser 4, which drops Mesh support).

[index.html](index.html) contains an example usage of this library: Importing the runtime and renderer, loading multiple sample animations at once from a given directory and an update loop with a configurable FPS limit.