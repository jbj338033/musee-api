export interface Track {
	id: number;
	title: string;
	artist: string;
	album: string | null;
	duration: number | null;
	youtube_url: string | null;
	youtube_id: string | null;
	filename: string;
	file_size: number | null;
	format: string;
	created_at: string;
	updated_at: string;
}

export interface Lyrics {
	id: number;
	track_id: number;
	content: string;
	is_synced: number;
	created_at: string;
	updated_at: string;
}

export interface DownloadTask {
	id: string;
	url: string;
	status: "pending" | "downloading" | "processing" | "completed" | "failed";
	progress: number;
	trackId: number | null;
	error: string | null;
	createdAt: number;
}

export interface LrcLine {
	time: number;
	text: string;
}

export interface LrclibResult {
	trackName: string;
	artistName: string;
	syncedLyrics: string | null;
	plainLyrics: string | null;
}
