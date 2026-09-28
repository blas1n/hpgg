import { hotsHref } from "@/data";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4 text-center">
      <div>
        <p className="text-6xl font-extrabold text-primary">404</p>
        <h1 id="meta-line" className="mt-3 text-lg font-bold">
          그런 페이지나 영웅이 없습니다
        </h1>
        <p className="mt-1 text-sm text-muted">주소를 확인하거나 영웅 목록에서 찾아 보세요.</p>
        <div className="mt-6 flex justify-center gap-2">
          <a href={hotsHref.home} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-ink">
            홈으로
          </a>
          <a href={hotsHref.heroes} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg-2">
            영웅 목록
          </a>
        </div>
      </div>
    </main>
  );
}
