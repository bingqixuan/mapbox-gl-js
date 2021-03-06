// @flow

type Config = {|
  API_URL: string,
  EVENTS_URL: string,
  FEEDBACK_URL: string,
  REQUIRE_ACCESS_TOKEN: boolean,
  ACCESS_TOKEN: ?string,
  MAX_PARALLEL_IMAGE_REQUESTS: number
|};

const config: Config = {
    API_URL: 'https://api.mapbox.com',
    get EVENTS_URL() {
        if (this.API_URL.indexOf('https://api.mapbox.cn') === 0) {
            return 'https://events.mapbox.cn/events/v2';
        } else {
            return 'https://events.mapbox.com/events/v2';
        }
    },
    FEEDBACK_URL: 'https://apps.mapbox.com/feedback',
    REQUIRE_ACCESS_TOKEN: true,
    ACCESS_TOKEN: 'pk.eyJ1IjoiYmluZ3FpeHVhbiIsImEiOiJjam56bTFuZW0xbzJsM3Fyd3B1cmRsa2k2In0.kuUVdYKBNNfoEfp1U0AK2Q',
    // ACCESS_TOKEN: 'pk.eyJ1IjoiYmluZ3FpeHVhbiIsImEiOiJjaXpueDN0dXowMmpiMndydnlvMTJvOTE3In0.D1J4poEFVeDk2T_fZD9wqw'
	MAX_PARALLEL_IMAGE_REQUESTS: 16
};

export default config;
