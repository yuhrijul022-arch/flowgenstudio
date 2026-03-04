

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const downloadImage = async (imageUrl: string, fileName: string) => {
    try {
        // Fetch image data from Supabase Storage
        const response = await fetch(imageUrl);

        if (!response.ok) throw new Error('Gagal mengambil gambar');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        // Membuat link sementara untuk trigger download
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || 'flowgen-result.png';
        document.body.appendChild(link);
        link.click();

        // Cleanup
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Download failed:", error);
        throw error;
    }
};

export async function downloadAll(
    items: Array<{ url: string; filename: string }>
) {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await downloadImage(item.url, item.filename);
        await delay(350);
    }
}
