function koa2() {
  const middlewares = [];

  const app = function (req, res) {
    const fn = compose(middlewares);
    const ctx = { req, res };
    return fn(ctx).catch((err) => {
      console.error(err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    });
  };

  function compose(middleware) {
    return function (context, next) {
      let index = -1;
      const chain = Promise.resolve();
      return dispatch(0);
      function dispatch(i) {
        if (i <= index) return Promise.reject(new Error("next() called multiple times"));
        index = i;
        let fn = middleware[i];
        if (i === middleware.length) fn = next;
        if (!fn) return Promise.resolve();
        try {
          return chain.then(() => fn(context, dispatch.bind(null, i + 1)));
        } catch (err) {
          return Promise.reject(err);
        }
      }
    };
  }

  app.use = function (middleware) {
    middlewares.push(middleware);
    return this;
  };

  return app;
}

const app = koa2();

for (let i = 0; i < 1000000; i++) {
  app.use(async (ctx, next) => {
    // console.log(ctx, "next" + i + "-before");
    await next();
    // console.log(ctx, "next" + i + "-after");
  });
}

app();
