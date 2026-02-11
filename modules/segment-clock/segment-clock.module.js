import { BaseModule } from '../../src/modules/base-module.js';

export default class SegmentClockModule extends BaseModule {
  constructor(context, config) {
    super(context, config);
    this._colonOn = false;
  }

  async initialize() {
    this.ctx.log('Segment Clock module initialized');
  }

  async execute() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes();

    // 12-hour format
    hours = hours % 12 || 12;

    // Format: space-padded hours + zero-padded minutes (e.g., " 105", "1234")
    const text = `${hours < 10 ? ' ' : ''}${hours}${minutes < 10 ? '0' : ''}${minutes}`;

    // Toggle colon each second
    this._colonOn = !this._colonOn;

    await this.ctx.write('segment_display', {
      text,
      colon: this._colonOn ? 1 : 0
    });
  }

  async cleanup() {
    // Clear the display on shutdown
    await this.ctx.write('segment_display', { text: '    ', colon: 0 });
    this.ctx.log('Segment Clock module stopped');
  }
}
