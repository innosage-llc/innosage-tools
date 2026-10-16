import type { Metadata } from 'next';
import VideoScissorsApp from './VideoScissorsApp';

export const metadata: Metadata = {
  title: 'Video Scissors | InnoSage DevTools',
  description:
    'Cut and trim MP4 videos locally in your browser. Desktop Chrome required. Media is processed locally; no media uploads.',
};

export default function VideoScissorsPage() {
  return <VideoScissorsApp />;
}
