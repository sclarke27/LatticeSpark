import { BaseModule } from '../../src/modules/base-module.js';

export default class CameraViewModule extends BaseModule {
  async initialize() {
    this.ctx.log('Camera View module initialized');
  }

  async execute() {
    // No backend logic — UI page handles stream, detections, and controls directly
  }

  async cleanup() {
    this.ctx.log('Camera View module stopped');
  }
}
