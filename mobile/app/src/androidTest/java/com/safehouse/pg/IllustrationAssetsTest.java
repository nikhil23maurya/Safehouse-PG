package com.safehouse.pg;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.InputStream;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class IllustrationAssetsTest {
    @Test public void bundledIllustrationsDecodeOfflineWithAlpha() throws Exception {
        Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();
        for(String name:new String[]{"residence","room","records"}){
            try(InputStream stream=app.getAssets().open("illustration-"+name+".webp")){
                Bitmap image=BitmapFactory.decodeStream(stream);
                assertNotNull("Bundled illustration must decode: "+name,image);
                assertTrue(image.getWidth()>0&&image.getWidth()<=900);
                assertTrue(image.getHeight()>0&&image.getHeight()<=700);
                assertTrue("Illustration alpha must be preserved",image.hasAlpha());
                image.recycle();
            }
        }
    }
}
