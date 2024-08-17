`node` 开发中，每个路由的处理函数都是一个中间件

一个路由可以有多个中间件，中间件在底层可以理解成一个数组，执行顺序是按照顺序执行的

```js
app.use(() => console.log("1"));
app.use(() => console.log("2"));
app.use(() => console.log("3"));
```

这些中间件是按照顺序保存在数组中 `middlewares`，每次请求到来时，会依次执行数组中的中间件

```js
middlewares = [() => console.log("1"), () => console.log("2"), () => console.log("3")];
```

## express 的 next

在 `express` 中，中间件是怎么实现的呢？

```js
function express() {
  const middlewares = [];

  function app() {}

  app.use = function (middleware) {
    middlewares.push(middleware);
    return this;
  };

  return app;
}
```

`use` 函数将 `middleware` 添加到 `middlewares` 数组中

`app` 中的核心逻辑是从 `middlewares` 数组中依次取出中间件，并执行

具体逻辑分为两部分：

1. 定义一个 `next`，立即执行，这是第一个中间件
2. 第一个中间件执行时，从 `middlewares` 数组中取出下一个中间件，给调用下个中间件的函数，将执行权交个用户

```js
const app = function (req, res) {
  let index = 0;
  function next(err) {
    if (err) return handleError(err);

    const middleware = middlewares[index++];
    if (!middleware) return;

    try {
      middleware(req, res, next);
    } catch (err) {
      next(err);
    }
  }

  function handleError(err) {
    console.error(err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }

  next();
};
```

这种写法会有个问题：

如果中间件函数过多，那么在执行时会遇到栈溢出的现象，怎么解决这个问题呢？

先来看下什么是栈溢出：

当函数被调用时，它会被添加到调用栈顶部。每个函数调用都会占用一定的栈空间。如果函数调用的嵌套层次太深，就会导致栈溢出

在 `node` 中的事件循环是这样的：

- 调用栈
- 消息队列（宏任务队列）
- 微任务队列

所以解决栈溢出的方法，可以使用 `setImmediate` 函数

`setImmediate` 将回调函数放入下一个事件循环的消息队列（宏任务队列）中。这意味着：

- 当前的函数调用完成后，调用栈会被清空
- 事件循环检查消息队列，找到我们的回调函数
- 回调函数被添加到一个新的、空的调用栈中执行

每次使用 `setImmediate`，实际上是在创建一个新的、独立的调用栈上下文，这样就避免了深度嵌套的同步操作链

每个中间件在自己的调用栈中运行，而不是在一个不断增长的单一调用栈中运行

所以优化后的代码

```js
const app = function (req, res) {
  let index = 0;
  function next(err) {
    setImmediate(() => {
      if (err) return handleError(err);

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
      console.error(err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    });
  }

  next();
};
```

那为什么不使用 `setTimeout` 和 `process.nextTick` 呢？

因为 `setTimeout(fn, 0)` 类似于 `setImmediate`，但可能有更大的延迟

而 `process.nextTick` 将回调放在微任务队列中，执行更快，但可能不会完全避免栈溢出问题，因为它在当前事件循环结束前执行

完整代码：

```js
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

for (let i = 0; i < 1000; i++) {
  app.use((req, res, next) => next());
}

app();
```

## koa2 中的 next

`koa2` 原生支持 `async/await`，所以中间件函数可以是异步函数，最著名的就是洋葱模型，如下所示

```js
const middleware1 = async (next) => {
  console.log("before 1");
  await next();
  console.log("after 1");
};
const middleware2 = async (next) => {
  console.log("before 2");
  await next();
  console.log("after 2");
};
console.log("before 1");
console.log("before 2");
console.log("after 2");
console.log("after 1");
```

`koa2` 中的也是都存储在一个数组中，每次请求到来时，依次执行数组中的中间件

```js
function koa2() {
  const middlewares = [];

  function app() {}

  app.use = function (middleware) {
    middlewares.push(middleware);
    return this;
  };

  return app;
}
```

和 `express` 的区别是在中间件的调度上，在调用中间件调用时使用了 `Promise`

```js
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
```

那这里是如何解决栈溢出的问题呢？

因为每个中间件函数都返回一个 `Promise`，而 `Promise` 链式调用不会有栈溢出的问题

所以每个中间件函数的调用不会累积在调用栈中，即使有大量的中间件，也不会导致调用栈的显著增长

完整代码：

```js
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

for (let i = 0; i < 10000; i++) {
  app.use(async (ctx, next) => {
    // console.log(ctx, "next" + i + "-before");
    await next();
    // console.log(ctx, "next" + i + "-after");
  });
}

app();
```
