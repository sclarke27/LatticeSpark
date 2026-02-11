export const METRIC_COLORS = {
  temperature: 'rgb(255, 99, 132)',
  temperature_f: 'rgb(255, 159, 64)',
  humidity: 'rgb(54, 162, 235)',
  distance: 'rgb(75, 192, 192)',
  accel_x: 'rgb(255, 159, 64)',
  accel_y: 'rgb(153, 102, 255)',
  accel_z: 'rgb(255, 205, 86)',
  gyro_x: 'rgb(255, 99, 132)',
  gyro_y: 'rgb(54, 162, 235)',
  gyro_z: 'rgb(75, 192, 192)'
};

export const AXIS_COLORS = {
  x: 'rgb(255, 99, 132)',
  y: 'rgb(54, 162, 235)',
  z: 'rgb(75, 192, 192)'
};

export function getColor(metric) {
  return METRIC_COLORS[metric] || 'rgb(201, 203, 207)';
}
