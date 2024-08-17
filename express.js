function express() {
  const middlewares = [];

  const app = function (req, res) {
    let index = 0;

    function next(err) {
      setImmediate(() => {
        if (err) {
          return handleError(err);
        }

        const middleware = middlewares[index++];
        if (!middleware) return;

        try {
          middleware(req, res, next);
        } catch (err) {
          next(err);
        }
      });
    }

    function handleError(err) {
      setImmediate(() => {
        const errorMiddleware = middlewares.find((mw) => mw.length === 4);
        if (errorMiddleware) {
          errorMiddleware(err, req, res, next);
        } else {
          console.error(err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    }

    next();
  };

  app.use = function (middleware) {
    middlewares.push(middleware);
    return this;
  };

  return app;
}

const app = express();

for (let i = 0; i < 1000000; i++) {
  app.use((req, res, next) => next());
}

app();
