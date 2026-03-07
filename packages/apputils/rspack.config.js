// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
const path = require('path');
const fs = require('fs');

const merge = require('webpack-merge').default;

const baseConfig = require('@jupyterlab/builder/lib/webpack.config.base');

const libDir = path.resolve(__dirname, 'lib');
const sourceFile = path.join(libDir, 'service-worker.js');
const destFile = path.resolve(libDir, 'service-worker-source.js');
fs.renameSync(sourceFile, destFile);

module.exports = [
  merge(baseConfig, {
    mode: 'development',
    devtool: 'source-map',
    entry: destFile,
    resolve: {
      fallback: {
        util: false,
      },
    },
    output: {
      filename: 'service-worker.js',
      path: libDir,
    },
  }),
];
