export function About({ onBack }: { onBack: () => void }) {
  return (
    <div className="page paper">
      <h1>About</h1>
      <p>This is <strong>blindspot-gaze</strong>, a standalone mock of the Blindspot reading room with webcam eye tracking. It is for education and for checking what gaze adds to Blindspot's cursor-based attention proxy. <strong>Not for clinical use.</strong></p>
      <h3>Films</h3>
      <p>By default the mock shows <strong>synthetic phantoms</strong> drawn by <code>mock/phantoms/generate.py</code>. They are not radiographs and carry no patient data.</p>
      <p>With <code>make films</code>, 20 real frontal chest radiographs are fetched from the public <a href="https://huggingface.co/datasets/MedOtter/ChestX-Det" target="_blank" rel="noreferrer">ChestX-Det</a> dataset (Hugging Face <code>MedOtter/ChestX-Det</code>): NIH ChestX-ray14 images with instance polygons for 13 finding types drawn by board-certified radiologists. Images are stored locally only and are never committed or hosted.</p>
      <p><strong>Attribution.</strong> Images: NIH Clinical Center, ChestX-ray14 (Wang et al., CVPR 2017). Annotations: ChestX-Det — Lian et al., <a href="https://arxiv.org/abs/2006.10550" target="_blank" rel="noreferrer">arXiv:2006.10550</a> and <a href="https://arxiv.org/abs/2104.10326" target="_blank" rel="noreferrer">arXiv:2104.10326</a>. Zones on real films are derived automatically and marked <em>approximate</em>.</p>
      <h3>Gaze</h3>
      <p>Providers: WebEyeTrack (MIT) with WebGazer (GPL-3.0, dynamically imported) as fallback. Camera frames never leave the browser. Every gaze number is labelled "Webcam gaze estimate, ±N px" with the accuracy measured for your session.</p>
      <h3>What gaze can and cannot say</h3>
      <p>Gaze separates "your eyes never reached this area" from "your eyes reached it for about N ms". It cannot say whether you <em>saw</em> something (Drew et al., 2013). Viewing order is reported descriptively; systematic order has not been shown to improve detection (Kok et al., 2016; van Geel et al., 2017).</p>
      <button onClick={onBack}>Back</button>
    </div>
  );
}
