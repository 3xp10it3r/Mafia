import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Mafia Game - Play Online With Friends",
    template: "%s | Mafia Game",
  },
  description:
    "Create a private online Mafia game room, invite friends with a room code, secretly assign roles, survive the night, and find the Mafia.",
  keywords: [
    "Mafia game",
    "online Mafia game",
    "play Mafia with friends",
    "Mafia party game",
    "social deduction game",
    "Werewolf alternative",
    "private game room",
  ],
  applicationName: "Mafia Game",
  authors: [{ name: "Mafia Game" }],
  creator: "Mafia Game",
  publisher: "Mafia Game",
  category: "games",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "Mafia Game - Private Online Social Deduction",
    description: "Host a private Mafia game with friends. Join by room code, receive secret roles, and uncover the Mafia.",
    type: "website",
    siteName: "Mafia Game",
  },
  twitter: {
    card: "summary",
    title: "Mafia Game - Play Online With Friends",
    description: "Create a private Mafia room and uncover the hidden Mafia before the town falls.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "VideoGame",
              name: "Mafia Game",
              description: "A private multiplayer Mafia social deduction game for playing with friends online.",
              genre: ["Party game", "Social deduction", "Multiplayer"],
              gamePlatform: "Web browser",
              applicationCategory: "Game",
              operatingSystem: "Any",
            }),
          }}
        />
      </body>
    </html>
  );
}
