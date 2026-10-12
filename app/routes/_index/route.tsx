import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <img className={styles.logo} src="/icon-512.png" alt="" width={96} height={96} />
        <h1 className={styles.heading}>Weather Slip</h1>
        <p className={styles.text}>
          Packing slips with the destination&apos;s weather forecast, so every
          parcel is packed for the weather it will travel in.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Print in bulk</strong>. Select unfulfilled orders and print
            their packing slips, or a customer list, in one go.
          </li>
          <li>
            <strong>Forecast on every slip</strong>. Each day&apos;s forecast
            at the destination, with dispatch and delivery days marked.
          </li>
          <li>
            <strong>Pay per order printed</strong>. Plans count orders you
            print with weather, once each. Reprints are free.
          </li>
        </ul>
      </div>
    </div>
  );
}
