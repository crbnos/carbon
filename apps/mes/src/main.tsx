import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Error from "~/components/Error";
import { path } from "~/config";
import "~/index.css";
import { MES } from "~/MES";
import { Login, loader as loginLoader } from "./routes/login";

const router = createBrowserRouter([
  {
    path: "/",
    element: <MES />,
    errorElement: <Error />,
    children: [
      {
        path: path.to.login,
        loader: loginLoader,
        element: <Login />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
