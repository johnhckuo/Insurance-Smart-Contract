module.exports = {
  build: {
    "index.html": "index.html",
    "app.js": [
      "javascripts/app.js"
    ],
    "app.css": [
      "stylesheets/app.css"
    ],
    "bootstrap.min.js": [
      "javascripts/bootstrap.min.js"
    ],
    "bootstrap.css": [
      "stylesheets/bootstrap.css"
    ],
    "jquery.js": [
      "javascripts/jquery.js"
    ],
    "images/": "images/"
  },
  rpc: {
    host: "localhost",
    port: 8545
  }
};
