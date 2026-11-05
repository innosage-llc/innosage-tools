import type { Metadata } from 'next';
import VideoScissorsApp from './VideoScissorsApp';

export const metadata: Metadata = {
  title: 'Video Scissors | Local Video Cutter & PNG Frame Export | InnoSage',
  description:
    'Trim H.264 MP4 videos or export original-resolution PNG frames from browser-playable MP4 files, including HEVC when supported. Local processing; no media uploads.',
  alternates: {
    canonical: 'https://innosage.co/tools/video-scissors',
  },
};

export default function VideoScissorsPage() {
  return <VideoScissorsApp />;
}
