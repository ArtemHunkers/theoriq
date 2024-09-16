        class ScrollyVideo {
            constructor({ src, scrollyVideoContainer, cover = true, sticky = true, full = true, trackScroll = true, lockScroll = true, transitionSpeed = 8, frameThreshold = 0.1, useWebCodecs = true, onReady = () => {}, onChange = () => {}, debug = false }) {
                if (typeof document === 'undefined') {
                    console.error('ScrollyVideo must be initiated in a DOM context');
                    return;
                }

                if (!scrollyVideoContainer) {
                    console.error('scrollyVideoContainer must be a valid DOM object');
                    return;
                }

                if (!src) {
                    console.error('Must provide valid video src to ScrollyVideo');
                    return;
                }

                if (scrollyVideoContainer instanceof Element) {
                    this.container = scrollyVideoContainer;
                } else {
                    if (typeof scrollyVideoContainer !== 'string') {
                        throw new Error('scrollyVideoContainer must be a valid DOM object');
                    }
                    this.container = document.getElementById(scrollyVideoContainer);
                    if (!this.container) {
                        throw new Error('scrollyVideoContainer must be a valid DOM object');
                    }
                }

                this.src = src;
                this.transitionSpeed = transitionSpeed;
                this.frameThreshold = frameThreshold;
                this.useWebCodecs = useWebCodecs;
                this.cover = cover;
                this.sticky = sticky;
                this.trackScroll = trackScroll;
                this.onReady = onReady;
                this.onChange = onChange;
                this.debug = debug;

                this.video = document.createElement('video');
                this.video.src = src;
                this.video.preload = 'auto';
                this.video.tabIndex = 0;
                this.video.autobuffer = true;
                this.video.playsInline = true;
                this.video.muted = true;
                this.video.pause();
                this.video.load();

                this.videoPercentage = 0;
                this.container.appendChild(this.video);

                if (sticky) {
                    this.container.style.display = 'block';
                    this.container.style.position = 'sticky';
                    this.container.style.top = '0';
                }

                if (full) {
                    this.container.style.width = '100%';
                    this.container.style.height = '100vh';
                    this.container.style.overflow = 'hidden';
                }

                if (cover) {
                    this.setCoverStyle(this.video);
                }

                const engine = (new UAParser()).getEngine();
                this.isSafari = engine.name === 'WebKit';
                debug && this.isSafari && console.info('Safari browser detected');

                this.currentTime = 0;
                this.targetTime = 0;
                this.canvas = null;
                this.context = null;
                this.frames = [];
                this.frameRate = 0;

                const debounce = (func, wait = 0) => {
                    let timeout;
                    return function(...args) {
                        const context = this;
                        clearTimeout(timeout);
                        timeout = setTimeout(() => func.apply(context, args), wait);
                    };
                };

                this.updateScrollPercentage = debounce(() => {
                    const rect = this.container.parentNode.getBoundingClientRect();
                    const scrollPercent = -rect.top / (rect.height - window.innerHeight);
                    this.debug && console.info('ScrollyVideo scrolled to', scrollPercent);
                    if (this.targetScrollPosition == null) {
                        this.setTargetTimePercent(scrollPercent, { jump: true });
                        this.onChange(scrollPercent);
                    } else if (Math.abs(window.pageYOffset - this.targetScrollPosition) < 1) {
                        this.targetScrollPosition = null;
                    }
                }, 100);

                if (trackScroll) {
                    window.addEventListener('scroll', this.updateScrollPercentage);
                    this.video.addEventListener('loadedmetadata', () => this.updateScrollPercentage(true), { once: true });
                } else {
                    this.video.addEventListener('loadedmetadata', () => this.setTargetTimePercent(0, { jump: true }), { once: true });
                }

                this.resize = () => {
                    this.debug && console.info('ScrollyVideo resizing...');
                    if (this.cover) {
                        this.setCoverStyle(this.canvas || this.video);
                    }
                    this.paintCanvasFrame(Math.floor(this.currentTime * this.frameRate));
                };

                window.addEventListener('resize', this.resize);
                this.video.addEventListener('progress', this.resize);
                this.decodeVideo();
            }

            setCoverStyle(element) {
                if (this.cover) {
                    element.style.position = 'absolute';
                    element.style.top = '50%';
                    element.style.left = '50%';
                    element.style.transform = 'translate(-50%, -50%)';
                    element.style.minWidth = '100%';
                    element.style.height = 'auto';
                    element.style.width = '100%'; // Устанавливаем ширину 100%
                }
            }

            async decodeVideo() {
                if (this.useWebCodecs && this.src) {
                    try {
                        await decodeVideo(this.src, (frame) => {
                            this.frames.push(frame);
                        }, this.debug);
                    } catch (error) {
                        this.debug && console.error('Error encountered while decoding video', error);
                        this.frames = [];
                        this.video.load();
                    }

                    if (this.frames.length === 0) {
                        this.debug && console.error('No frames were received from webCodecs');
                        this.onReady();
                        return;
                    }

                    this.frameRate = this.frames.length / this.video.duration;
                    this.debug && console.info('Received', this.frames.length, 'frames');

                    this.canvas = document.createElement('canvas');
                    this.context = this.canvas.getContext('2d');
                    this.video.style.display = 'none';
                    this.container.appendChild(this.canvas);
                    if (this.cover) {
                        this.setCoverStyle(this.canvas);
                    }
                    this.paintCanvasFrame(Math.floor(this.currentTime * this.frameRate));
                    this.onReady();
                } else {
                    this.debug && console.warn('Cannot perform video decode: useWebCodes disabled');
                }
            }

            paintCanvasFrame(frameIndex) {
                const frame = this.frames[frameIndex];
                if (!this.canvas || !frame) return;

                this.debug && console.info('Painting frame', frameIndex);
                this.canvas.width = frame.width;
                this.canvas.height = frame.height;

                this.canvas.style.width = '100%';
                this.canvas.style.height = 'auto';

                this.context.drawImage(frame, 0, 0, frame.width, frame.height);
            }

            transitionToTargetTime({ jump, transitionSpeed = this.transitionSpeed, easing = null }) {
                this.debug && console.info('Transitioning targetTime:', this.targetTime, 'currentTime:', this.currentTime);
                const diff = this.targetTime - this.currentTime;
                const absDiff = Math.abs(diff);
                const duration = 1000 * absDiff;
                const isForward = diff > 0;
                const step = ({ startCurrentTime, startTimestamp, timestamp }) => {
                    const progress = (timestamp - startTimestamp) / duration;
                    const isComplete = isForward ? this.currentTime >= this.targetTime : this.currentTime <= this.targetTime;
                    if (isNaN(this.targetTime) || Math.abs(this.targetTime - this.currentTime) < this.frameThreshold || isComplete) {
                        this.video.pause();
                        if (this.transitioningRaf) {
                            cancelAnimationFrame(this.transitioningRaf);
                            this.transitioningRaf = null;
                        }
                        return;
                    }

                    if (this.targetTime > this.video.duration) {
                        this.targetTime = this.video.duration;
                    }
                    if (this.targetTime < 0) {
                        this.targetTime = 0;
                    }

                    const diff = this.targetTime - this.currentTime;
                    const nextTime = easing && Number.isFinite(progress)
                        ? startCurrentTime + easing(progress) * absDiff
                        : isForward
                            ? startCurrentTime + Math.abs(diff) * transitionSpeed
                            : startCurrentTime - Math.abs(diff) * transitionSpeed;

                    if (this.canvas) {
                        if (jump) {
                            this.currentTime = this.targetTime;
                        } else if (easing) {
                            this.currentTime = nextTime;
                        } else {
                            this.currentTime += diff / (256 / transitionSpeed);
                        }
                        this.paintCanvasFrame(Math.floor(this.currentTime * this.frameRate));
                    } else {
                        if (jump || this.isSafari || !isForward) {
                            this.video.pause();
                            if (easing) {
                                this.currentTime = nextTime;
                            } else {
                                this.currentTime += diff / (64 / transitionSpeed);
                            }
                            if (jump) {
                                this.currentTime = this.targetTime;
                            }
                            this.video.currentTime = this.currentTime;
                        } else {
                            const playbackRate = Math.max(Math.min(4 * diff, transitionSpeed, 16), 1);
                            this.debug && console.info('ScrollyVideo playbackRate:', playbackRate);
                            if (!isNaN(playbackRate)) {
                                this.video.playbackRate = playbackRate;
                                this.video.play();
                            }
                            this.currentTime = this.video.currentTime;
                        }
                    }

                    if (typeof requestAnimationFrame === 'function') {
                        this.transitioningRaf = requestAnimationFrame((timestamp) => step({ startCurrentTime, startTimestamp, timestamp }));
                    }
                };

                if (typeof requestAnimationFrame === 'function') {
                    this.transitioningRaf = requestAnimationFrame((timestamp) => {
                        step({ startCurrentTime: this.currentTime, startTimestamp: timestamp, timestamp });
                    });
                }
            }

            setTargetTimePercent(percent, options = {}) {
                const duration = this.frames.length && this.frameRate ? this.frames.length / this.frameRate : this.video.duration;
                this.targetTime = Math.max(Math.min(percent, 1), 0) * duration;
                if (!options.jump && Math.abs(this.currentTime - this.targetTime) < this.frameThreshold) {
                    return;
                }
                if (!this.canvas && !this.video.paused) {
                    this.video.play();
                }
                this.transitionToTargetTime(options);
            }

            setScrollPercent(percent) {
                if (!this.trackScroll) {
                    console.warn('setScrollPercent requires enabled trackScroll');
                    return;
                }
                const containerRect = this.container.parentNode.getBoundingClientRect();
                const targetScrollPosition = containerRect.top + window.pageYOffset + (containerRect.height - window.innerHeight) * percent;
                if (Math.abs(window.pageYOffset - targetScrollPosition) < 1) {
                    this.targetScrollPosition = null;
                } else {
                    window.scrollTo({ top: targetScrollPosition, behavior: 'smooth' });
                    this.targetScrollPosition = targetScrollPosition;
                }
            }

            destroy() {
                this.debug && console.info('Destroying ScrollyVideo');
                if (this.trackScroll) {
                    window.removeEventListener('scroll', this.updateScrollPercentage);
                }
                window.removeEventListener('resize', this.resize);
                if (this.container) {
                    this.container.innerHTML = '';
                }
            }
        }

        function decodeVideo(url, frameCallback, debug) {
            return new Promise((resolve, reject) => {
                debug && console.info('Decoding video from', url);
                try {
                    const file = MP4Box.createFile();
                    let videoDecoder;
                    const videoTrack = null;
                    const videoFrames = [];
                    const videoDecoderConfig = null;

                    const decoder = new VideoDecoder({
                        output: (frame) => {
                            createImageBitmap(frame, { resizeQuality: 'low' }).then((bitmap) => {
                                frameCallback(bitmap);
                                frame.close();
                                if (decoder.decodeQueueSize <= 0) {
                                    setTimeout(() => {
                                        if (decoder.state !== 'closed') {
                                            decoder.close();
                                            resolve();
                                        }
                                    }, 500);
                                }
                            });
                        },
                        error: (error) => {
                            console.error(error);
                            reject(error);
                        }
                    });

                    file.onReady = (info) => {
                        if (info && info.videoTracks && info.videoTracks[0]) {
                            const [track] = info.videoTracks;
                            debug && console.info('Video with codec:', track.codec);
                            const avcCBox = track.mdia.minf.stbl.stsd.entries[0].avcC;
                            const description = avcCBoxToDescription(avcCBox);
                            decoder.configure({
                                codec: track.codec,
                                description
                            });
                            file.setExtractionOptions(track.id);
                            file.start();
                        } else {
                            reject(new Error('URL provided is not a valid mp4 video file.'));
                        }
                    };

                    file.onSamples = (id, user, samples) => {
                        for (let i = 0; i < samples.length; i++) {
                            const sample = samples[i];
                            const chunkType = sample.is_sync ? 'key' : 'delta';
                            const chunk = new EncodedVideoChunk({
                                type: chunkType,
                                timestamp: sample.cts,
                                duration: sample.duration,
                                data: sample.data
                            });
                            decoder.decode(chunk);
                        }
                    };

                    fetch(url).then((response) => {
                        const reader = response.body.getReader();
                        let offset = 0;
                        reader.read().then(function process({ done, value }) {
                            if (done) {
                                file.flush();
                                return null;
                            }
                            const buffer = value.buffer;
                            buffer.fileStart = offset;
                            offset += buffer.byteLength;
                            file.appendBuffer(buffer);
                            return reader.read().then(process);
                        });
                    });
                } catch (error) {
                    reject(error);
                }
            });
        }

        function avcCBoxToDescription(avcCBox) {
            let length = 7;
            for (let i = 0; i < avcCBox.SPS.length; i++) {
                length += 2 + avcCBox.SPS[i].length;
            }
            for (let i = 0; i < avcCBox.PPS.length; i++) {
                length += 2 + avcCBox.PPS[i].length;
            }
            const buffer = new DataView(new ArrayBuffer(length));
            let offset = 0;
            buffer.setUint8(offset++, avcCBox.configurationVersion);
            buffer.setUint8(offset++, avcCBox.AVCProfileIndication);
            buffer.setUint8(offset++, avcCBox.profile_compatibility);
            buffer.setUint8(offset++, avcCBox.AVCLevelIndication);
            buffer.setUint8(offset++, avcCBox.lengthSizeMinusOne + 252);
            buffer.setUint8(offset++, avcCBox.nb_SPS_nalus + 224);
            for (let i = 0; i < avcCBox.SPS.length; i++) {
                buffer.setUint16(offset, avcCBox.SPS[i].length);
                offset += 2;
                new Uint8Array(buffer.buffer).set(avcCBox.SPS[i].nalu, offset);
                offset += avcCBox.SPS[i].length;
            }
            buffer.setUint8(offset++, avcCBox.nb_PPS_nalus);
            for (let i = 0; i < avcCBox.PPS.length; i++) {
                buffer.setUint16(offset, avcCBox.PPS[i].length);
                offset += 2;
                new Uint8Array(buffer.buffer).set(avcCBox.PPS[i].nalu, offset);
                offset += avcCBox.PPS[i].length;
            }
            return buffer.buffer;
        }

        // Инициализация ScrollyVideo
        new ScrollyVideo({
            src: "https://dl.dropbox.com/scl/fi/5x8pe53nl2k34278fwv26/Tech-dark.MP4?rlkey=g5h8n5vkbtil72hy3vdks0ii0&st=a93jb78b&dl=0",
            scrollyVideoContainer: "scrolly-video",
            cover: true,
            sticky: false,
            full: false,
            trackScroll: true,
            lockScroll: true,
            transitionSpeed: 8,
            frameThreshold: 0.1,
            useWebCodecs: true,
            onReady: () => console.log('Video is ready'),
            onChange: (percent) => console.log('Video percent:', percent),
            debug: true
        });
