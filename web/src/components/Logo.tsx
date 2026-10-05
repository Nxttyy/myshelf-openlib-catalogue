export function Logo({ size = 19 }: { size?: number }) {
  return (
    <div className="f-wordmark" style={{ fontSize: size * 1.45 }} aria-label="Dora">DORA</div>
  )
}
