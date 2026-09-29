import { NotFoundBody } from "@/routes/not-found";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4 text-center">
      <div>
        <p className="text-6xl font-extrabold text-primary">404</p>
        <NotFoundBody locale="ko" />
      </div>
    </main>
  );
}
