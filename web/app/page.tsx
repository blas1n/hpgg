/** hpgg.win root: one game so far — forward to /hots/. */
export default function Root() {
  return (
    <>
      <meta httpEquiv="refresh" content="0; url=/hots/" />
      <main className="grid min-h-screen place-items-center">
        <a href="/hots/" className="text-primary">
          hpgg.win · Heroes of the Storm →
        </a>
      </main>
    </>
  );
}
