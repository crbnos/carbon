import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Authentication } from "~/components/Authentication";
import Error from "~/components/Error";
import { path } from "~/config";
import "~/index.css";
import { Job, loader as jobLoader } from "~/routes/job";
import { Jobs, loader as jobsLoader } from "~/routes/jobs";

const router = createBrowserRouter([
  {
    path: path.to.root,
    element: <Authentication />,
    errorElement: <Error />,
    children: [
      {
        path: path.to.jobs,
        loader: jobsLoader,
        element: <Jobs navCollapsedSize={4} />,
        children: [
          {
            path: ":operationId",
            loader: jobLoader,
            element: <Job />,
          },
        ],
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
