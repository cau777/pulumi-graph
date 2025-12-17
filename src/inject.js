const objects = [];

function createMock(tree) {
  const handler = {
    get(target, prop) {
      switch (prop) {
        case "getProject":
          return () => "mock-project";
        case "getStack":
          return () => "mock-stack";
        case "__tree":
          return tree;
        default:
          return createMock([...tree, "." + String(prop)]);
      }
    },

    apply(target, thisArg, args) {
      return createMock([...tree, "()"]);
    },

    construct(target, args) {
      objects.push({
        tree: tree,
        name: args[0] && String(args[0]),
        args: args[1],
      });
      return createMock([objects.length - 1]);
    },

    set(target, prop, value) {
      return true;
    },

    has(target, prop) {
      return false;
    },

    deleteProperty(target, prop) {
      return true;
    },

    ownKeys() {
      return [];
    },

    getPrototypeOf() {
      return null;
    },
  };

  // This has to be a function (not a lambda or an object) so the `new` keyword works.
  const proxy = new Proxy(function () {}, handler);
  return proxy;
}

const baseRequire = require;
// var is required to overwrite the global require function
var require = (id) => {
  if (id.includes("pulumi")) {
    return createMock([id]);
  } else {
    return baseRequire(id);
  }
};

exports.objects = objects;
