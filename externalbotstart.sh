#!/bin/bash
cd /achilles/externalbot
junod q wasm cs all juno1lqqv9qt5ghlpzsy0wsk02zh0qdansm8fkh9rjz97ke4zvh78254qx80jj6 --output json > tmp.json
node external.js
#forever start index.js

