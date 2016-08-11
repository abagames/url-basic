var LiveReloadPlugin = require('webpack-livereload-plugin');

module.exports = {
  entry: './src/index.ts',
  output: {
    path: './www/urlbasic',
    filename: 'index.js',
    library: 'urlbasic',
    libraryTarget: 'umd'
  },
  resolve: {
    extensions: ['.ts', "", ".webpack.js", ".web.js", ".js"]
  },
  //devtool: 'source-map',
  module: {
    loaders: [
      {
        test: /\.ts$/,
        exclude: /(node_modules|web_modules)/,
        loader: 'ts-loader'
      }
    ]
  },
  plugins: [
    new LiveReloadPlugin()
  ]
};