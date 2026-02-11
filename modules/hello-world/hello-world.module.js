import { BaseModule } from '../../src/modules/base-module.js';

export default class HelloWorldModule extends BaseModule {
  async initialize() {
    this.ctx.log('Hello World module initialized!');
    this.ctx.emitState({ lastMessage: null, lcdText: '' });
  }

  async execute() {
    const data = this.ctx.read('temperature_sensor');
    if (data) {
      this.ctx.log(`Temperature: ${data.temperature}°C, Humidity: ${data.humidity}%`);
    } else {
      this.ctx.log('Waiting for temperature data...');
    }
  }

  async onSensorChange(componentId, newData, prevData) {
    if (componentId === 'temperature_sensor' && prevData) {
      const diff = (newData.temperature - prevData.temperature).toFixed(1);
      if (Math.abs(diff) >= 0.1) {
        this.ctx.log(`Temperature changed by ${diff}°C`);
      }
    }
  }

  async handleCommand(command, params) {
    this.ctx.log(`Received command: ${command}, params: ${JSON.stringify(params)}`);

    if (command === 'greet') {
      const name = params.name || 'World';
      const message = `Hello, ${name}!`;
      this.ctx.emitState({ lastMessage: message, lcdText: this._lcdText ?? '' });
      return { message };
    }

    if (command === 'lcd') {
      const text = params.text || '';
      this._lcdText = text;
      await this.ctx.write('lcd_display', { line1: text, line2: '' });
      this.ctx.emitState({ lastMessage: null, lcdText: text });
      return { success: true };
    }

    return { echo: command, params };
  }

  async cleanup() {
    this.ctx.log('Hello World module shutting down. Goodbye!');
  }
}
