import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Authentication } from "~/components/Authentication";
import Error from "~/components/Error";
import "~/index.css";
import { Home } from "./routes";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Authentication />,
    errorElement: <Error />,
    children: [
      {
        path: "/",
        element: <Home />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
