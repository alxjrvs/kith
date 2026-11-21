import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <main className="page">
      <h1>Nothing here</h1>
      <p className="muted">
        Orrey does not have a page at this address. <Link to="/">Back to the front page</Link>
      </p>
    </main>
  );
}
