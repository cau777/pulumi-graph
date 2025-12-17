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
          return createMock([...tree, prop]);
      }
    },

    apply(target, thisArg, args) {
      return createMock([...tree, "()"]);
    },

    construct(target, args) {
      objects.push({
        tree: tree,
        name: String(args[0]),
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

  const proxy = new Proxy(() => {}, handler);
  return proxy;
}

const baseRequire = require;
var require = (id) => {
  if (id.includes("pulumi")) {
    return createMock([id]);
  } else {
    return baseRequire(id);
  }
};

exports.objects = objects;
