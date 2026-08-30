/* 由 extract-config.js 从 index.html 内联配置自动生成，请勿手改 */
module.exports = {
  "content": [
    "D:\\tark\\index.html",
    "D:\\tark\\js\\**\\*.js",
    "D:\\tark\\css\\**\\*.css"
  ],
  "theme": {
    "extend": {
      "colors": {
        "neon-cyan": "var(--neon-cyan)",
        "neon-magenta": "var(--neon-magenta)",
        "neon-gold": "var(--coin-gold)",
        "bg-deep": "var(--bg-deep)",
        "bg-panel": "var(--panel-bg)",
        "text-hi": "var(--text-hi)",
        "text-mid": "var(--text-mid)",
        "text-lo": "var(--text-lo)"
      },
      "fontFamily": {
        "sans": [
          "Plus Jakarta Sans",
          "PingFang SC",
          "system-ui",
          "sans-serif"
        ],
        "mono": [
          "JetBrains Mono",
          "Share Tech Mono",
          "monospace"
        ],
        "tech": [
          "Share Tech Mono",
          "monospace"
        ]
      },
      "animation": {
        "fadeIn": "fadeIn 0.4s ease-out both",
        "scaleIn": "scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "scanLine": "scanLine 4s linear infinite",
        "coinPulse": "coinPulse 1.2s ease-in-out infinite",
        "timerPulse": "timerPulse 1s ease-in-out infinite",
        "shake": "shake 0.4s ease-in-out",
        "blink": "blink 1.2s ease-in-out infinite",
        "floatY": "floatY 2.4s ease-in-out infinite",
        "shine": "shine 2.2s linear infinite",
        "scalePulse": "scalePulse 1.8s ease-in-out infinite"
      },
      "keyframes": {
        "fadeIn": {
          "0%": {
            "opacity": "0"
          },
          "100%": {
            "opacity": "1"
          }
        },
        "scaleIn": {
          "0%": {
            "transform": "scale(0.85)",
            "opacity": "0"
          },
          "100%": {
            "transform": "scale(1)",
            "opacity": "1"
          }
        },
        "scanLine": {
          "0%": {
            "transform": "translateY(-100%)"
          },
          "100%": {
            "transform": "translateY(100vh)"
          }
        },
        "coinPulse": {
          "0%,100%": {
            "transform": "scale(1)",
            "filter": "brightness(1)"
          },
          "50%": {
            "transform": "scale(1.08)",
            "filter": "brightness(1.4)"
          }
        },
        "timerPulse": {
          "0%,100%": {
            "color": "var(--text-hi)"
          },
          "50%": {
            "color": "var(--neon-magenta)",
            "textShadow": "0 0 10px var(--neon-magenta)"
          }
        },
        "blink": {
          "0%,100%": {
            "opacity": "1"
          },
          "50%": {
            "opacity": "0.25"
          }
        },
        "floatY": {
          "0%,100%": {
            "transform": "translateY(0)"
          },
          "50%": {
            "transform": "translateY(-6px)"
          }
        },
        "shine": {
          "0%": {
            "transform": "translateX(-120%) skewX(-20deg)"
          },
          "100%": {
            "transform": "translateX(220%) skewX(-20deg)"
          }
        },
        "shake": {
          "0%,100%": {
            "transform": "translateX(0)"
          },
          "20%": {
            "transform": "translateX(-4px)"
          },
          "40%": {
            "transform": "translateX(4px)"
          },
          "60%": {
            "transform": "translateX(-3px)"
          },
          "80%": {
            "transform": "translateX(3px)"
          }
        },
        "scalePulse": {
          "0%,100%": {
            "transform": "scale(1)"
          },
          "50%": {
            "transform": "scale(1.05)"
          }
        }
      }
    }
  },
  "corePlugins": {
    "preflight": true
  }
};
