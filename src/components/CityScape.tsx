'use client';

export function CityScape() {
  return (
    <div className="cityscape">
      <svg
        viewBox="0 0 1920 400"
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Glow filter for windows */}
          <filter id="windowGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Gradient for buildings */}
          <linearGradient id="buildingGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a1a0d" />
            <stop offset="100%" stopColor="#050a06" />
          </linearGradient>
          {/* Sky glow at horizon */}
          <linearGradient id="skyGlow" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#00ff4108" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>

        {/* Sky glow layer */}
        <rect x="0" y="0" width="1920" height="400" fill="url(#skyGlow)" />

        {/* === BACK ROW (tallest skyscrapers, darkest) === */}
        <g fill="#060d07" opacity="0.6">
          {/* Tall spire left */}
          <rect x="80" y="20" width="60" height="380" />
          <polygon points="80,20 110,0 140,20" />
          
          {/* Wide tower */}
          <rect x="200" y="60" width="90" height="340" />
          
          {/* Twin towers */}
          <rect x="370" y="30" width="50" height="370" />
          <rect x="430" y="45" width="50" height="355" />
          
          {/* Mega tower center */}
          <rect x="700" y="10" width="80" height="390" />
          <polygon points="700,10 740,0 780,10" />
          
          {/* Right cluster */}
          <rect x="1000" y="50" width="70" height="350" />
          <rect x="1100" y="25" width="55" height="375" />
          <polygon points="1100,25 1127,5 1155,25" />
          
          <rect x="1300" y="40" width="85" height="360" />
          <rect x="1500" y="55" width="60" height="345" />
          <rect x="1650" y="15" width="70" height="385" />
          <polygon points="1650,15 1685,0 1720,15" />
          
          <rect x="1800" y="65" width="80" height="335" />
        </g>

        {/* === MIDDLE ROW === */}
        <g fill="#081210" opacity="0.75">
          <rect x="30" y="120" width="70" height="280" />
          <rect x="150" y="90" width="55" height="310" />
          <rect x="280" y="110" width="100" height="290" />
          
          {/* Stepped building */}
          <rect x="460" y="140" width="80" height="260" />
          <rect x="470" y="120" width="60" height="20" />
          <rect x="480" y="100" width="40" height="20" />
          
          <rect x="580" y="80" width="65" height="320" />
          <rect x="800" y="100" width="90" height="300" />
          
          {/* Antenna tower */}
          <rect x="950" y="130" width="50" height="270" />
          <rect x="970" y="70" width="6" height="60" />
          
          <rect x="1050" y="95" width="75" height="305" />
          <rect x="1200" y="115" width="60" height="285" />
          <rect x="1400" y="85" width="80" height="315" />
          
          {/* Dome building */}
          <rect x="1560" y="140" width="90" height="260" />
          <ellipse cx="1605" cy="140" rx="45" ry="20" />
          
          <rect x="1730" y="100" width="65" height="300" />
          <rect x="1860" y="130" width="60" height="270" />
        </g>

        {/* === FRONT ROW (shortest, darkest) === */}
        <g fill="#0a150b">
          <rect x="0" y="220" width="120" height="180" />
          <rect x="130" y="200" width="80" height="200" />
          <rect x="240" y="230" width="110" height="170" />
          <rect x="380" y="210" width="70" height="190" />
          <rect x="500" y="240" width="100" height="160" />
          <rect x="630" y="190" width="85" height="210" />
          <rect x="750" y="220" width="95" height="180" />
          <rect x="880" y="200" width="75" height="200" />
          <rect x="990" y="230" width="110" height="170" />
          <rect x="1130" y="210" width="80" height="190" />
          <rect x="1240" y="195" width="90" height="205" />
          <rect x="1370" y="225" width="100" height="175" />
          <rect x="1490" y="205" width="70" height="195" />
          <rect x="1600" y="235" width="110" height="165" />
          <rect x="1740" y="215" width="85" height="185" />
          <rect x="1850" y="200" width="70" height="200" />
        </g>

        {/* === WINDOW LIGHTS (scattered green/cyan dots) === */}
        <g filter="url(#windowGlow)">
          {/* Left cluster windows */}
          <rect x="95" y="50" width="3" height="3" fill="#00ff41" opacity="0.8" />
          <rect x="115" y="80" width="3" height="3" fill="#00ff41" opacity="0.6" />
          <rect x="95" y="120" width="3" height="3" fill="#00d4ff" opacity="0.7" />
          <rect x="125" y="160" width="3" height="3" fill="#00ff41" opacity="0.5" />
          
          {/* Center tower windows */}
          <rect x="720" y="40" width="3" height="3" fill="#00ff41" opacity="0.9" />
          <rect x="740" y="70" width="3" height="3" fill="#00d4ff" opacity="0.7" />
          <rect x="720" y="100" width="3" height="3" fill="#00ff41" opacity="0.6" />
          <rect x="750" y="130" width="3" height="3" fill="#ffb000" opacity="0.5" />
          <rect x="730" y="170" width="3" height="3" fill="#00ff41" opacity="0.8" />
          
          {/* Right cluster windows */}
          <rect x="1115" y="55" width="3" height="3" fill="#00ff41" opacity="0.7" />
          <rect x="1135" y="90" width="3" height="3" fill="#00d4ff" opacity="0.6" />
          <rect x="1320" y="70" width="3" height="3" fill="#00ff41" opacity="0.8" />
          <rect x="1340" y="110" width="3" height="3" fill="#ffb000" opacity="0.4" />
          <rect x="1670" y="40" width="3" height="3" fill="#00ff41" opacity="0.9" />
          <rect x="1690" y="80" width="3" height="3" fill="#00d4ff" opacity="0.7" />
          <rect x="1670" y="120" width="3" height="3" fill="#00ff41" opacity="0.5" />
          
          {/* Middle row windows */}
          <rect x="300" y="140" width="3" height="3" fill="#00ff41" opacity="0.6" />
          <rect x="320" y="180" width="3" height="3" fill="#00d4ff" opacity="0.5" />
          <rect x="600" y="110" width="3" height="3" fill="#00ff41" opacity="0.7" />
          <rect x="830" y="130" width="3" height="3" fill="#ffb000" opacity="0.4" />
          <rect x="960" y="150" width="3" height="3" fill="#00ff41" opacity="0.6" />
          <rect x="1420" y="115" width="3" height="3" fill="#00d4ff" opacity="0.7" />
          <rect x="1580" y="165" width="3" height="3" fill="#00ff41" opacity="0.5" />
          <rect x="1750" y="130" width="3" height="3" fill="#00ff41" opacity="0.8" />

          {/* Front row windows */}
          <rect x="50" y="250" width="3" height="3" fill="#00ff41" opacity="0.5" />
          <rect x="80" y="280" width="3" height="3" fill="#ffb000" opacity="0.3" />
          <rect x="160" y="240" width="3" height="3" fill="#00d4ff" opacity="0.4" />
          <rect x="520" y="270" width="3" height="3" fill="#00ff41" opacity="0.5" />
          <rect x="660" y="220" width="3" height="3" fill="#00ff41" opacity="0.6" />
          <rect x="910" y="240" width="3" height="3" fill="#00d4ff" opacity="0.5" />
          <rect x="1270" y="230" width="3" height="3" fill="#00ff41" opacity="0.4" />
          <rect x="1510" y="250" width="3" height="3" fill="#ffb000" opacity="0.3" />
          <rect x="1770" y="245" width="3" height="3" fill="#00ff41" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}
