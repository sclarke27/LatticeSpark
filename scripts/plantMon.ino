#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <DHT_U.h>

#define DHTTYPE DHT11

int soilSensor1Pin = 0;
int lightSensor1Pin = 1;
int tmpSensor1Pin = 2;
int tmpSensor2Pin = 3;
int relayPin = 8;

float soilSensor1Value = 0.0;
float lightSensor1Value = 0.0;
float tmpSensor1Value = 0.0;
float tmpSensor2Value = 0.0;
float humiditySensor1Value = 0.0;
float humiditySensor2Value = 0.0;

bool lightOn = false;

DHT_Unified dht1(tmpSensor1Pin, DHTTYPE);
DHT_Unified dht2(tmpSensor2Pin, DHTTYPE);

void setup() {
  Serial.begin(9600);
  dht1.begin();
  dht2.begin();
  pinMode(relayPin, OUTPUT);
}

float handleTmp36Value(int rawValue) {
  float voltage = rawValue * 5;
  voltage /= 1024.0;
  float tempC = (voltage - 0.5) * 100;

  return ((9.0 / 5.0) * tempC + 32.0);
}

void emitJsonPayload() {
  Serial.print(F("{\"values\":{\"soil\":"));
  Serial.print(soilSensor1Value, 2);
  Serial.print(F(",\"light\":"));
  Serial.print(lightSensor1Value, 2);
  Serial.print(F(",\"temperatureCh1\":"));
  Serial.print(tmpSensor1Value, 2);
  Serial.print(F(",\"temperatureCh2\":"));
  Serial.print(tmpSensor2Value, 2);
  Serial.print(F(",\"humidityCh1\":"));
  Serial.print(humiditySensor1Value, 2);
  Serial.print(F(",\"humidityCh2\":"));
  Serial.print(humiditySensor2Value, 2);
  Serial.println(F("}}"));
}

void loop() {
  
  if(Serial.available() > 0) {
    String incomingMsg = Serial.readString();
    if(incomingMsg.substring(0) == "lightOn") {
      if(!lightOn) {
        lightOn = true;
        digitalWrite(relayPin, HIGH);
      }
    }
    if(incomingMsg.substring(0) == "lightOff") {
      if(lightOn) {
        lightOn = false;
        digitalWrite(relayPin, LOW);
      }
    }

  }
  soilSensor1Value = analogRead(soilSensor1Pin);
  lightSensor1Value = analogRead(lightSensor1Pin);

  sensors_event_t event;
  dht1.temperature().getEvent(&event);
  if (!isnan(event.temperature)) {
    tmpSensor1Value = event.temperature;
  }
  // Get humidity event and print its value.
  dht1.humidity().getEvent(&event);
  if (!isnan(event.relative_humidity)) {
    humiditySensor1Value = event.relative_humidity;
  }  

  dht2.temperature().getEvent(&event);
  if (!isnan(event.temperature)) {
    tmpSensor2Value = event.temperature;
  }
  // Get humidity event and print its value.
  dht2.humidity().getEvent(&event);
  if (!isnan(event.relative_humidity)) {
    humiditySensor2Value = event.relative_humidity;
  }  

  emitJsonPayload();

  delay(100);
}
