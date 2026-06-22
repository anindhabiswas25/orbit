import { Providers } from '../providers'
import { DevNav } from '@/components/developers/dev-nav'

export default function DevelopersLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Providers>
      <div className="min-h-screen bg-background text-foreground noise-overlay">
        {/* Ambient gradient wash */}
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="absolute -top-40 left-1/4 h-[480px] w-[480px] rounded-full bg-[#a78bfa]/8 blur-[140px]" />
          <div className="absolute top-1/3 right-0 h-[420px] w-[420px] rounded-full bg-[#67e8f9]/6 blur-[140px]" />
          <div className="absolute bottom-0 left-0 h-[360px] w-[360px] rounded-full bg-[#eca8d6]/6 blur-[140px]" />
        </div>

        <div className="relative z-10">
          <DevNav />
          {/* Top padding clears the fixed navbar (h-20 at rest). */}
          <main className="mx-auto max-w-[1400px] px-6 lg:px-12 pt-28 lg:pt-32 pb-10 lg:pb-14">
            {children}
          </main>
        </div>
      </div>
    </Providers>
  )
}
