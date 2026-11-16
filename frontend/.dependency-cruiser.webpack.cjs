const { resolve } = require("node:path");

module.exports = {
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
};
